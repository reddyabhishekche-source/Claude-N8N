/**
 * index.js — Auto Test Orchestrator
 *
 * Flow (mirrors the n8n workflow):
 *   1. Login → get access + refresh tokens
 *   2. Fetch OpenAPI spec from the running server
 *   3. Parse all endpoints from spec (schema-parser)
 *   4. Generate every test case automatically (test-case-generator)
 *   5. Execute all test cases dynamically (test-executor)
 *      • Auto-refreshes token on 401 without stopping
 *   6. Print a full colour report with pass/fail/SLA/coverage
 *   7. Logout & revoke tokens
 *
 * Zero hardcoded endpoints — everything is driven by the Swagger spec.
 */

'use strict';

const axios = require('axios');
const chalk = require('chalk');
const { parseSpec } = require('./schema-parser');
const { generateAllTestCases } = require('./test-case-generator');
const { executeAll } = require('./test-executor');

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const SWAGGER_URL = `${BASE_URL}/api/openapi.json`;
const LOGIN_URL = `${BASE_URL}/api/auth/login`;
const REFRESH_URL = `${BASE_URL}/api/auth/refresh`;
const LOGOUT_URL = `${BASE_URL}/api/auth/logout`;
const CREDENTIALS = {
  email: process.env.API_USER || 'admin@skyline.com',
  password: process.env.API_PASS || 'Admin@1234'
};
const VERBOSE = process.env.VERBOSE === 'true';

// ─── Auth helpers ─────────────────────────────────────────────────────────────
async function login() {
  const res = await axios.post(LOGIN_URL, CREDENTIALS);
  if (res.status !== 200 || !res.data.accessToken) {
    throw new Error(`Login failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
  }
  return { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken };
}

async function refreshToken(currentRefreshToken) {
  const res = await axios.post(REFRESH_URL, { refreshToken: currentRefreshToken }, {
    validateStatus: () => true
  });
  if (res.status !== 200 || !res.data.accessToken) {
    throw new Error(`Token refresh failed: HTTP ${res.status}`);
  }
  return { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken };
}

async function logout(accessToken, currentRefreshToken) {
  await axios.post(LOGOUT_URL,
    { refreshToken: currentRefreshToken },
    { headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true }
  );
}

// ─── Spec fetcher ─────────────────────────────────────────────────────────────
async function fetchSpec() {
  const res = await axios.get(SWAGGER_URL);
  if (res.status !== 200) throw new Error(`Could not fetch spec: HTTP ${res.status}`);
  return res.data;
}

// ─── Printer ──────────────────────────────────────────────────────────────────
const TYPE_ICON = {
  positive: chalk.green('+'),
  negative: chalk.red('-'),
  boundary: chalk.yellow('B'),
  auth: chalk.magenta('A')
};

function printLive(result, index, total) {
  const { testCase: tc, passed, actualStatus, expectedStatus, responseTimeMs, slaViolated, tokenRefreshed } = result;

  const icon = passed ? chalk.green('PASS') : chalk.red('FAIL');
  const sla = slaViolated ? chalk.yellow(' ⚡SLA') : '';
  const refresh = tokenRefreshed ? chalk.cyan(' ↺') : '';
  const typeIcon = TYPE_ICON[tc.type] || '?';
  const counter = chalk.dim(`[${String(index).padStart(3)}/${total}]`);
  const statusColor = passed ? chalk.dim : chalk.red;
  const codes = statusColor(`${actualStatus ?? 'ERR'}`);

  if (VERBOSE || !passed) {
    console.log(`  ${counter} ${icon} ${typeIcon} ${tc.description.padEnd(58)} ${codes} ${chalk.dim(responseTimeMs + 'ms')}${sla}${refresh}`);
  } else {
    process.stdout.write(passed ? chalk.green('.') : chalk.red('F'));
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────
function printReport(results, runId, elapsed) {
  const total = results.length;
  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);
  const slaVio = results.filter(r => r.slaViolated);
  const refreshed = results.filter(r => r.tokenRefreshed);

  const byType = {};
  for (const r of results) {
    const t = r.testCase.type;
    if (!byType[t]) byType[t] = { pass: 0, fail: 0 };
    r.passed ? byType[t].pass++ : byType[t].fail++;
  }

  const passRate = Math.round((passed.length / total) * 100);
  const avgMs = Math.round(results.reduce((s, r) => s + r.responseTimeMs, 0) / total);
  const maxMs = Math.max(...results.map(r => r.responseTimeMs));

  if (!VERBOSE) console.log(''); // newline after dot-progress

  const line = chalk.bold.white('═'.repeat(68));
  console.log('\n' + line);
  console.log(chalk.bold.white('  AIRLINE API — AUTOMATED TEST REPORT'));
  console.log(line);
  console.log(`\n  Run ID        ${chalk.cyan(runId)}`);
  console.log(`  Completed     ${chalk.dim(new Date().toISOString())}`);
  console.log(`  Total time    ${chalk.dim(elapsed + 'ms')}`);
  console.log(`  API target    ${chalk.dim(BASE_URL)}`);

  console.log(`\n  Total cases   ${chalk.bold(total)}`);
  console.log(`  Passed        ${chalk.green.bold(passed.length)}`);
  console.log(`  Failed        ${failed.length > 0 ? chalk.red.bold(failed.length) : chalk.green.bold(0)}`);
  console.log(`  SLA violations ${slaVio.length > 0 ? chalk.yellow.bold(slaVio.length) : chalk.green.bold(0)}  (threshold: 2000ms)`);
  console.log(`  Token refreshes ${chalk.cyan.bold(refreshed.length)}`);
  console.log(`  Avg response  ${chalk.dim(avgMs + 'ms')}   Max: ${chalk.dim(maxMs + 'ms')}`);

  const pctColor = passRate === 100 ? chalk.green.bold : passRate >= 80 ? chalk.yellow.bold : chalk.red.bold;
  console.log(`\n  Pass rate     ${pctColor(passRate + '%')}`);

  // By test type
  console.log('\n  By test type:');
  const typeLabels = { positive: 'Positive  ', negative: 'Negative  ', boundary: 'Boundary  ', auth: 'Auth      ' };
  for (const [type, counts] of Object.entries(byType)) {
    const p = counts.pass + counts.fail;
    const pct = Math.round((counts.pass / p) * 100);
    const bar = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)));
    console.log(`    ${(typeLabels[type] || type).padEnd(12)} ${bar} ${pct}%  (${counts.pass}/${p})`);
  }

  // By endpoint tag
  const byEndpoint = {};
  for (const r of results) {
    const ep = r.testCase.id.split('_positive')[0].split('_neg')[0].split('_auth')[0].split('_boundary')[0];
    if (!byEndpoint[ep]) byEndpoint[ep] = { pass: 0, fail: 0 };
    r.passed ? byEndpoint[ep].pass++ : byEndpoint[ep].fail++;
  }
  console.log('\n  By endpoint:');
  for (const [ep, counts] of Object.entries(byEndpoint)) {
    const p = counts.pass + counts.fail;
    const pct = Math.round((counts.pass / p) * 100);
    const color = pct === 100 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
    const short = ep.replace(/^(GET|POST|PUT|DELETE|PATCH)_/, '').replace(/_api_/g, '/').replace(/_/g, '/');
    console.log(`    ${color('•')} ${short.padEnd(40)} ${color(pct + '%')} (${counts.pass}/${p})`);
  }

  // Failures detail
  if (failed.length > 0) {
    console.log('\n' + chalk.red.bold('  Failed Tests:'));
    for (const r of failed) {
      const tc = r.testCase;
      const why = r.error
        ? chalk.dim(r.error.substring(0, 60))
        : `expected ${tc.expectedStatus}, got ${chalk.red(r.actualStatus)}`;
      console.log(`    ${chalk.red('✗')} ${tc.description}`);
      console.log(`      ${chalk.dim(tc.method)} ${chalk.dim(tc.url)}`);
      console.log(`      ${why}`);
    }
  }

  // SLA violations
  if (slaVio.length > 0) {
    console.log('\n' + chalk.yellow.bold('  SLA Violations (>2000ms):'));
    for (const r of slaVio) {
      console.log(`    ${chalk.yellow('⚡')} ${r.testCase.description} — ${chalk.yellow(r.responseTimeMs + 'ms')}`);
    }
  }

  const overall = failed.length === 0
    ? chalk.green.bold('\n  ✅  ALL TESTS PASSED')
    : chalk.red.bold(`\n  ❌  ${failed.length} TEST(S) FAILED`);
  console.log(overall);
  console.log('\n' + line + '\n');

  return failed.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const runId = `RUN-${Date.now()}`;
  const runStart = Date.now();

  console.log(chalk.bold.blue('\n✈  SkyLine Airline — Automatic API Test Runner'));
  console.log(chalk.dim(`   Run ID  : ${runId}`));
  console.log(chalk.dim(`   Target  : ${BASE_URL}`));
  console.log(chalk.dim(`   Swagger : ${SWAGGER_URL}\n`));

  // Step 1 — Login
  process.stdout.write(chalk.dim('  [1/6] Authenticating...'));
  let tokens;
  try {
    tokens = await login();
    console.log(chalk.green(' OK'));
  } catch (err) {
    console.log(chalk.red(' FAILED'));
    console.error(chalk.red(`  → ${err.message}`));
    console.error(chalk.dim('  Is the airline-api server running? cd airline-api && npm start'));
    process.exit(1);
  }

  // Step 2 — Fetch spec
  process.stdout.write(chalk.dim('  [2/6] Fetching OpenAPI spec...'));
  let spec;
  try {
    spec = await fetchSpec();
    console.log(chalk.green(` OK  (${Object.keys(spec.paths || {}).length} paths)`));
  } catch (err) {
    console.log(chalk.red(' FAILED'));
    console.error(chalk.red(`  → ${err.message}`));
    process.exit(1);
  }

  // Step 3 — Parse endpoints
  process.stdout.write(chalk.dim('  [3/6] Parsing endpoints...'));
  const endpoints = parseSpec(spec);
  console.log(chalk.green(` OK  (${endpoints.length} endpoints found)`));

  // Step 4 — Generate test cases
  process.stdout.write(chalk.dim('  [4/6] Generating test cases...'));
  const testCases = generateAllTestCases(endpoints, BASE_URL);
  console.log(chalk.green(` OK  (${testCases.length} cases auto-generated)`));

  // Breakdown by type
  const typeCounts = testCases.reduce((acc, tc) => {
    acc[tc.type] = (acc[tc.type] || 0) + 1;
    return acc;
  }, {});
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(chalk.dim(`       ${type.padEnd(12)}: ${count}`));
  }

  // Step 5 — Execute
  console.log(chalk.dim(`\n  [5/6] Running ${testCases.length} tests against ${BASE_URL}...\n`));
  if (!VERBOSE) console.log(chalk.dim('  (use VERBOSE=true for per-test output)\n  '));

  const { results, tokenState: finalTokens } = await executeAll(
    testCases,
    tokens,
    refreshToken,
    printLive
  );

  // Step 6 — Logout
  process.stdout.write(chalk.dim('\n  [6/6] Logging out...'));
  try {
    await logout(finalTokens.accessToken, finalTokens.refreshToken);
    console.log(chalk.green(' OK\n'));
  } catch (_) {
    console.log(chalk.dim(' (skipped)\n'));
  }

  // Report
  const elapsed = Date.now() - runStart;
  const failCount = printReport(results, runId, elapsed);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(chalk.red.bold('\nFatal:'), err.message);
  process.exit(1);
});
