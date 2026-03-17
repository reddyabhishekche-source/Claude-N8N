/**
 * Airline API Test Runner
 * Simulates the full n8n pipeline: auth → 15 API calls → refresh token → report
 *
 * Run: node index.js
 * Requires airline-api to be running on http://localhost:3000
 */

const axios = require('axios');
const chalk = require('chalk');

const BASE_URL = 'http://localhost:3000';
const SLA_THRESHOLD_MS = 2000;

// ─── State ────────────────────────────────────────────────────────────────────
let accessToken = null;
let refreshToken = null;
const testResults = [];
let testRunId = `RUN-${Date.now()}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function apiCall(config, options = {}) {
  const { name, expectedStatus = 200 } = options;
  const start = Date.now();

  try {
    const response = await axios({
      baseURL: BASE_URL,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      validateStatus: () => true, // don't throw on 4xx/5xx
      ...config
    });

    const responseTimeMs = Date.now() - start;
    const slaViolated = responseTimeMs > SLA_THRESHOLD_MS;
    const passed = response.status === expectedStatus;

    const result = {
      name,
      endpoint: `${config.method?.toUpperCase() || 'GET'} ${config.url}`,
      expectedStatus,
      actualStatus: response.status,
      responseTimeMs,
      slaViolated,
      passed,
      body: response.data
    };

    testResults.push(result);
    printResult(result);
    return response;
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const result = {
      name,
      endpoint: `${config.method?.toUpperCase() || 'GET'} ${config.url}`,
      expectedStatus,
      actualStatus: null,
      responseTimeMs,
      slaViolated: false,
      passed: false,
      error: err.message
    };
    testResults.push(result);
    printResult(result);
    return null;
  }
}

function printResult(r) {
  const status = r.passed
    ? chalk.green('  PASS')
    : chalk.red('  FAIL');
  const sla = r.slaViolated ? chalk.yellow(` [SLA!]`) : '';
  const time = chalk.dim(`${r.responseTimeMs}ms`);
  const codes = r.passed
    ? chalk.dim(`${r.actualStatus}`)
    : chalk.red(`expected ${r.expectedStatus}, got ${r.actualStatus ?? 'ERROR'}`);

  console.log(`${status} ${chalk.bold(r.name.padEnd(40))} ${codes} ${time}${sla}`);
}

function separator(label) {
  console.log('\n' + chalk.cyan('─'.repeat(60)));
  console.log(chalk.cyan.bold(` ${label}`));
  console.log(chalk.cyan('─'.repeat(60)));
}

// ─── Test Suite ───────────────────────────────────────────────────────────────
async function runTests() {
  console.log(chalk.bold.blue('\n✈  SkyLine Airline API — Automated Test Runner'));
  console.log(chalk.dim(`   Run ID: ${testRunId}`));
  console.log(chalk.dim(`   Target: ${BASE_URL}`));
  console.log(chalk.dim(`   SLA Threshold: ${SLA_THRESHOLD_MS}ms\n`));

  // ── STEP 1: Authenticate ──────────────────────────────────────────────────
  separator('PHASE 1 — Authentication');

  const loginRes = await apiCall({
    method: 'POST',
    url: '/api/auth/login',
    data: { email: 'admin@skyline.com', password: 'Admin@1234' }
  }, { name: '1. POST /auth/login', expectedStatus: 200 });

  if (!loginRes?.data?.accessToken) {
    console.log(chalk.red.bold('\n  FATAL: Login failed. Is the server running?\n'));
    process.exit(1);
  }

  accessToken = loginRes.data.accessToken;
  refreshToken = loginRes.data.refreshToken;
  console.log(chalk.dim(`   Token acquired. Expires in: ${loginRes.data.expiresIn}s`));

  // Negative: wrong password
  await apiCall({
    method: 'POST',
    url: '/api/auth/login',
    data: { email: 'admin@skyline.com', password: 'wrongpassword' }
  }, { name: '1b. POST /auth/login (neg: bad pass)', expectedStatus: 401 });

  // ── STEP 2: Airport Tests ─────────────────────────────────────────────────
  separator('PHASE 2 — Airport Endpoints');

  await apiCall({
    method: 'GET',
    url: '/api/airports'
  }, { name: '2. GET /airports (list all)', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/airports?country=USA'
  }, { name: '2b. GET /airports?country=USA', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/airports/JFK'
  }, { name: '3. GET /airports/JFK', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/airports/XXX'
  }, { name: '3b. GET /airports/XXX (neg: not found)', expectedStatus: 404 });

  // ── STEP 3: Flight Tests ──────────────────────────────────────────────────
  separator('PHASE 3 — Flight Search & Details');

  await apiCall({
    method: 'GET',
    url: '/api/flights/search?origin=JFK&destination=LHR&date=2024-08-15'
  }, { name: '4. GET /flights/search (JFK→LHR)', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/flights/search?origin=LAX&destination=DXB&class=economy'
  }, { name: '4b. GET /flights/search (LAX→DXB, economy)', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/flights/search'
  }, { name: '4c. GET /flights/search (neg: no params)', expectedStatus: 400 });

  await apiCall({
    method: 'GET',
    url: '/api/flights/FL001'
  }, { name: '5. GET /flights/FL001', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/flights/INVALID'
  }, { name: '5b. GET /flights/INVALID (neg: 404)', expectedStatus: 404 });

  // ── STEP 4: Seat Availability ─────────────────────────────────────────────
  separator('PHASE 4 — Seat Availability');

  await apiCall({
    method: 'GET',
    url: '/api/seats/FL001?class=business'
  }, { name: '6. GET /seats/FL001?class=business', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/seats/FL001'
  }, { name: '6b. GET /seats/FL001 (all classes)', expectedStatus: 200 });

  // ── STEP 5: Passenger Management ─────────────────────────────────────────
  separator('PHASE 5 — Passengers');

  const createPassRes = await apiCall({
    method: 'POST',
    url: '/api/passengers',
    data: {
      firstName: 'Emily',
      lastName: 'Rodriguez',
      email: 'emily.r@testmail.com',
      phone: '+1-555-9900',
      passport: `US${Date.now().toString().slice(-7)}`,
      nationality: 'American',
      dateOfBirth: '1992-11-05'
    }
  }, { name: '7. POST /passengers (create)', expectedStatus: 201 });

  await apiCall({
    method: 'POST',
    url: '/api/passengers',
    data: { email: 'missing@fields.com' }
  }, { name: '7b. POST /passengers (neg: missing fields)', expectedStatus: 400 });

  await apiCall({
    method: 'GET',
    url: '/api/passengers/P001'
  }, { name: '8. GET /passengers/P001', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/passengers/P999'
  }, { name: '8b. GET /passengers/P999 (neg: 404)', expectedStatus: 404 });

  // ── STEP 6: Bookings ──────────────────────────────────────────────────────
  separator('PHASE 6 — Bookings');

  const createBookingRes = await apiCall({
    method: 'POST',
    url: '/api/bookings',
    data: {
      flightId: 'FL002',
      passengerId: 'P002',
      class: 'economy',
      meals: ['halal']
    }
  }, { name: '9. POST /bookings (create)', expectedStatus: 201 });

  await apiCall({
    method: 'POST',
    url: '/api/bookings',
    data: { flightId: 'FL001' }
  }, { name: '9b. POST /bookings (neg: missing fields)', expectedStatus: 400 });

  await apiCall({
    method: 'GET',
    url: '/api/bookings/BK001'
  }, { name: '10. GET /bookings/BK001', expectedStatus: 200 });

  // ── STEP 7: Token Refresh (mid-workflow) ──────────────────────────────────
  separator('PHASE 7 — Token Refresh (mid-workflow rotation)');

  const refreshRes = await apiCall({
    method: 'POST',
    url: '/api/auth/refresh',
    headers: {}, // no auth header needed
    data: { refreshToken }
  }, { name: '11. POST /auth/refresh', expectedStatus: 200 });

  if (refreshRes?.data?.accessToken) {
    accessToken = refreshRes.data.accessToken;
    refreshToken = refreshRes.data.refreshToken;
    console.log(chalk.dim('   Tokens rotated. Continuing with fresh access token...'));
  }

  await apiCall({
    method: 'POST',
    url: '/api/auth/refresh',
    data: { refreshToken: 'invalid.refresh.token' }
  }, { name: '11b. POST /auth/refresh (neg: bad token)', expectedStatus: 403 });

  // ── STEP 8: Check-in ──────────────────────────────────────────────────────
  separator('PHASE 8 — Check-in');

  await apiCall({
    method: 'POST',
    url: '/api/check-in',
    data: { bookingId: 'BK001', seatPreference: 'window', baggageCount: 1 }
  }, { name: '12. POST /check-in (BK001)', expectedStatus: 200 });

  // Negative: check in again on same booking
  await apiCall({
    method: 'POST',
    url: '/api/check-in',
    data: { bookingId: 'BK001' }
  }, { name: '12b. POST /check-in (neg: already checked in)', expectedStatus: 409 });

  // ── STEP 9: Baggage ───────────────────────────────────────────────────────
  separator('PHASE 9 — Baggage Allowance');

  await apiCall({
    method: 'GET',
    url: '/api/baggage/allowance?class=economy'
  }, { name: '13. GET /baggage/allowance?class=economy', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/baggage/allowance'
  }, { name: '13b. GET /baggage/allowance (all classes)', expectedStatus: 200 });

  await apiCall({
    method: 'GET',
    url: '/api/baggage/allowance?class=executive'
  }, { name: '13c. GET /baggage/allowance (neg: invalid class)', expectedStatus: 400 });

  // ── STEP 10: Payments ─────────────────────────────────────────────────────
  separator('PHASE 10 — Payments');

  await apiCall({
    method: 'POST',
    url: '/api/payments',
    data: { bookingId: 'BK001', paymentMethod: 'credit_card', cardLast4: '4242', amount: 2712 }
  }, { name: '14. POST /payments (correct amount)', expectedStatus: 201 });

  await apiCall({
    method: 'POST',
    url: '/api/payments',
    data: { bookingId: 'BK001', paymentMethod: 'debit_card', cardLast4: '1234', amount: 100 }
  }, { name: '14b. POST /payments (neg: insufficient amount)', expectedStatus: 400 });

  // ── STEP 11: Cancellation (negative — checked-in booking) ────────────────
  separator('PHASE 11 — Booking Cancellation (Negative Test)');

  await apiCall({
    method: 'PUT',
    url: '/api/bookings/BK001/cancel'
  }, { name: '15. PUT /bookings/BK001/cancel (neg: checked-in)', expectedStatus: 403 });

  // Cancel a non-checked-in booking
  const newBookingId = createBookingRes?.data?.booking?.id;
  if (newBookingId) {
    await apiCall({
      method: 'PUT',
      url: `/api/bookings/${newBookingId}/cancel`
    }, { name: `15b. PUT /bookings/${newBookingId}/cancel (pos)`, expectedStatus: 200 });
  }

  // ── STEP 12: Auth edge cases ──────────────────────────────────────────────
  separator('PHASE 12 — Auth Edge Cases');

  // Test missing token → 401
  const savedToken = accessToken;
  accessToken = null;
  await apiCall({
    method: 'GET',
    url: '/api/flights/FL001'
  }, { name: '16. GET /flights/FL001 (neg: no token)', expectedStatus: 401 });
  accessToken = savedToken;

  // Test expired/invalid token → 403
  accessToken = 'invalid.jwt.token';
  await apiCall({
    method: 'GET',
    url: '/api/flights/FL001'
  }, { name: '16b. GET /flights/FL001 (neg: invalid token)', expectedStatus: 403 });
  accessToken = savedToken;

  // ── STEP 13: Logout ───────────────────────────────────────────────────────
  separator('PHASE 13 — Logout & Token Revocation');

  await apiCall({
    method: 'POST',
    url: '/api/auth/logout',
    data: { refreshToken }
  }, { name: '17. POST /auth/logout', expectedStatus: 200 });

  // ── FINAL REPORT ──────────────────────────────────────────────────────────
  printReport();
}

function printReport() {
  const passed = testResults.filter(r => r.passed);
  const failed = testResults.filter(r => !r.passed);
  const slaViolations = testResults.filter(r => r.slaViolated);
  const passRate = Math.round((passed.length / testResults.length) * 100);
  const avgTime = Math.round(testResults.reduce((s, r) => s + r.responseTimeMs, 0) / testResults.length);

  console.log('\n' + chalk.bold.white('═'.repeat(60)));
  console.log(chalk.bold.white(' AIRLINE API TEST REPORT'));
  console.log(chalk.bold.white('═'.repeat(60)));

  console.log(`\n  Run ID:       ${chalk.cyan(testRunId)}`);
  console.log(`  Completed:    ${chalk.dim(new Date().toISOString())}`);
  console.log(`  Total Tests:  ${chalk.bold(testResults.length)}`);
  console.log(`  Passed:       ${chalk.green.bold(passed.length)}`);
  console.log(`  Failed:       ${failed.length > 0 ? chalk.red.bold(failed.length) : chalk.green.bold(0)}`);
  console.log(`  SLA Violations: ${slaViolations.length > 0 ? chalk.yellow.bold(slaViolations.length) : chalk.green.bold(0)}`);
  console.log(`  Pass Rate:    ${passRate >= 90 ? chalk.green.bold(`${passRate}%`) : chalk.red.bold(`${passRate}%`)}`);
  console.log(`  Avg Response: ${chalk.dim(`${avgTime}ms`)}`);

  const overall = failed.length === 0 ? chalk.green.bold('✅ ALL TESTS PASSED') : chalk.red.bold('❌ SOME TESTS FAILED');
  console.log(`\n  Overall:      ${overall}`);

  if (failed.length > 0) {
    console.log('\n' + chalk.red.bold('  Failed Tests:'));
    failed.forEach(f => {
      console.log(chalk.red(`    • ${f.name}: expected ${f.expectedStatus}, got ${f.actualStatus ?? f.error}`));
    });
  }

  if (slaViolations.length > 0) {
    console.log('\n' + chalk.yellow.bold('  SLA Violations (>' + SLA_THRESHOLD_MS + 'ms):'));
    slaViolations.forEach(v => {
      console.log(chalk.yellow(`    • ${v.name}: ${v.responseTimeMs}ms`));
    });
  }

  console.log('\n' + chalk.bold.white('  Endpoint Coverage:'));
  const categories = {
    'Auth':       testResults.filter(r => r.endpoint.includes('/auth')),
    'Airports':   testResults.filter(r => r.endpoint.includes('/airport')),
    'Flights':    testResults.filter(r => r.endpoint.includes('/flight') || r.endpoint.includes('/seat')),
    'Passengers': testResults.filter(r => r.endpoint.includes('/passenger')),
    'Bookings':   testResults.filter(r => r.endpoint.includes('/booking') || r.endpoint.includes('/cancel')),
    'Operations': testResults.filter(r => r.endpoint.includes('/check-in') || r.endpoint.includes('/baggage') || r.endpoint.includes('/payment'))
  };

  for (const [cat, tests] of Object.entries(categories)) {
    const catPassed = tests.filter(t => t.passed).length;
    const pct = tests.length ? Math.round((catPassed / tests.length) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    const color = pct === 100 ? chalk.green : pct >= 80 ? chalk.yellow : chalk.red;
    console.log(`    ${cat.padEnd(12)} ${color(bar)} ${pct}% (${catPassed}/${tests.length})`);
  }

  console.log('\n' + chalk.bold.white('═'.repeat(60)) + '\n');

  process.exit(failed.length > 0 ? 1 : 0);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
runTests().catch(err => {
  console.error(chalk.red.bold('\n  Fatal error:'), err.message);
  process.exit(1);
});
