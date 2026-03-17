/**
 * test-executor.js
 * Dynamically fires any TestCase produced by test-case-generator.
 * Token injection, auto-refresh, and SLA tracking are handled here.
 *
 * No endpoint is hardcoded — every HTTP call is built from the TestCase object.
 */

'use strict';

const axios = require('axios');

const TOKEN_PLACEHOLDER = '__ACCESS_TOKEN__';
const MAX_RETRIES = 1; // one auto-refresh attempt on 401

/**
 * Replace the token placeholder in headers with the live access token.
 */
function injectToken(headers, accessToken) {
  const result = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = typeof v === 'string' ? v.replace(TOKEN_PLACEHOLDER, accessToken || '') : v;
  }
  return result;
}

/**
 * Build an axios request config from a TestCase.
 */
function buildRequestConfig(testCase, accessToken, baseConfig = {}) {
  const headers = injectToken(testCase.headers, accessToken);

  const config = {
    method: testCase.method.toLowerCase(),
    url: testCase.url,
    headers,
    params: Object.keys(testCase.queryParams || {}).length ? testCase.queryParams : undefined,
    data: testCase.body !== null ? testCase.body : undefined,
    validateStatus: () => true,   // never throw on HTTP error status
    timeout: testCase.slaMs + 2000,
    ...baseConfig
  };

  return config;
}

/**
 * Execute a single TestCase.
 * Returns a TestResult object:
 *   { testCase, passed, actualStatus, responseTimeMs, slaViolated, body, error }
 */
async function executeTestCase(testCase, accessToken) {
  const start = Date.now();
  let response;
  let error = null;

  try {
    const config = buildRequestConfig(testCase, accessToken);
    response = await axios(config);
  } catch (err) {
    error = err.message;
  }

  const responseTimeMs = Date.now() - start;
  const actualStatus = response?.status ?? null;
  const slaViolated = responseTimeMs > testCase.slaMs;
  const passed = !error && actualStatus === testCase.expectedStatus;

  return {
    testCase,
    passed,
    actualStatus,
    expectedStatus: testCase.expectedStatus,
    responseTimeMs,
    slaViolated,
    body: response?.data ?? null,
    error
  };
}

/**
 * Execute all test cases sequentially with automatic token refresh.
 *
 * @param {Array}    testCases     - Array of TestCase objects
 * @param {object}   tokenState    - { accessToken, refreshToken }
 * @param {Function} refreshFn     - async (refreshToken) → { accessToken, refreshToken }
 * @param {Function} onResult      - optional callback(result, index, total)
 */
async function executeAll(testCases, tokenState, refreshFn, onResult) {
  const results = [];
  let { accessToken, refreshToken } = tokenState;
  let tokenRefreshedAt = Date.now();

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];

    // Skip auth-type cases from refresh logic — they test token failure deliberately
    const isAuthTest = tc.type === 'auth';

    let result = await executeTestCase(tc, accessToken);

    // Auto-refresh on unexpected 401 (token expired during test run)
    if (!isAuthTest && result.actualStatus === 401 && Date.now() - tokenRefreshedAt > 5000) {
      try {
        const newTokens = await refreshFn(refreshToken);
        accessToken = newTokens.accessToken;
        refreshToken = newTokens.refreshToken;
        tokenRefreshedAt = Date.now();

        // Retry once with fresh token
        result = await executeTestCase(tc, accessToken);
        result.tokenRefreshed = true;
      } catch (refreshErr) {
        result.refreshError = refreshErr.message;
      }
    }

    results.push(result);
    if (onResult) onResult(result, i + 1, testCases.length);
  }

  // Return updated token state alongside results
  return { results, tokenState: { accessToken, refreshToken } };
}

module.exports = { executeTestCase, executeAll, injectToken };
