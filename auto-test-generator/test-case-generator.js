/**
 * test-case-generator.js
 * Reads parsed endpoint descriptors and emits TestCase objects.
 *
 * Each TestCase has everything needed to fire a single HTTP call:
 *   { id, type, method, url, headers, queryParams, body, expectedStatus, slaMs, description }
 *
 * Test types produced per endpoint:
 *   positive   – valid payload/params → 2xx
 *   neg_missing_field  – drop each required body field → 400
 *   neg_wrong_type     – send wrong type for fields → 400
 *   neg_boundary_min   – value one below minimum → 400
 *   neg_boundary_max   – value one above maximum → 400
 *   neg_invalid_id     – garbage path param → 404
 *   auth_no_token      – omit Authorization → 401
 *   auth_bad_token     – malformed token → 403
 */

'use strict';

const DEFAULT_SLA_MS = 2000;

// ─── Value generators ─────────────────────────────────────────────────────────

/**
 * Generate a valid (positive) value for a schema node.
 */
function positiveValue(schema, fieldName = '') {
  if (!schema) return 'value';

  // Use the spec's own example first
  if (schema.example !== undefined) return schema.example;

  switch (schema.type) {
    case 'integer':
    case 'number': {
      const min = schema.minimum ?? 1;
      const max = schema.maximum ?? 100;
      return Math.round((min + max) / 2);
    }
    case 'boolean':
      return true;
    case 'array': {
      const item = positiveValue(schema.items || { type: 'string' });
      return [item];
    }
    case 'object': {
      const obj = {};
      for (const [k, v] of Object.entries(schema.properties || {})) {
        obj[k] = positiveValue(v, k);
      }
      return obj;
    }
    case 'string':
    default: {
      if (schema.enum?.length) return schema.enum[0];
      if (schema.format === 'email') return `test_${fieldName || 'user'}@airline-test.com`;
      if (schema.format === 'date') return '2024-08-15';
      if (schema.format === 'date-time') return '2024-08-15T08:00:00Z';

      // Respect length constraints
      const minLen = schema.minLength || 1;
      const maxLen = schema.maxLength || 20;
      const target = Math.min(Math.max(minLen, 6), maxLen);
      const base = (fieldName || 'value').substring(0, target).padEnd(target, 'x');
      return base;
    }
  }
}

/**
 * Build a complete positive body object from a body schema.
 */
function buildPositiveBody(bodySchema) {
  if (!bodySchema) return null;
  if (bodySchema.type !== 'object' && !bodySchema.properties) {
    return positiveValue(bodySchema);
  }

  const body = {};
  const required = new Set(bodySchema.required || []);

  for (const [field, schema] of Object.entries(bodySchema.properties || {})) {
    // Always include required fields; include optional ones in positive test too
    body[field] = positiveValue(schema, field);
  }
  return body;
}

/**
 * Substitute path params with positive values.
 * e.g. /api/flights/{id}  →  /api/flights/FL001
 */
function interpolatePath(path, pathParamValues) {
  let result = path;
  for (const [name, value] of Object.entries(pathParamValues)) {
    result = result.replace(`{${name}}`, encodeURIComponent(value));
  }
  return result;
}

/**
 * Build positive path-param values from the endpoint descriptor.
 */
function buildPositivePathParams(endpoint) {
  const values = {};
  for (const p of endpoint.pathParams) {
    values[p.name] = positiveValue(p.schema, p.name);
  }
  // Provide sensible seeded defaults for common airline IDs
  const defaults = {
    id: 'FL001', flightId: 'FL001', code: 'JFK',
    bookingId: 'BK001', passengerId: 'P001'
  };
  for (const name of endpoint.pathParamNames) {
    if (!values[name]) values[name] = defaults[name] || `TEST_${name.toUpperCase()}`;
  }
  return values;
}

/**
 * Build positive query params from the endpoint descriptor.
 */
function buildPositiveQueryParams(endpoint) {
  const params = {};
  for (const p of endpoint.queryParams) {
    params[p.name] = p.example !== undefined ? p.example : positiveValue(p.schema, p.name);
  }
  // Domain-specific seeds for flight search
  if (endpoint.path.includes('/flights/search')) {
    params.origin = params.origin || 'JFK';
    params.destination = params.destination || 'LHR';
    params.date = params.date || '2024-08-15';
  }
  return params;
}

// ─── Test-case builder ────────────────────────────────────────────────────────

function makeCase(overrides) {
  return {
    id: '',
    type: 'positive',
    method: 'GET',
    url: '',
    headers: {},
    queryParams: {},
    body: null,
    expectedStatus: 200,
    slaMs: DEFAULT_SLA_MS,
    description: '',
    ...overrides
  };
}

/**
 * Given one endpoint descriptor, generate all test cases for it.
 */
function generateCasesForEndpoint(endpoint, baseUrl) {
  const cases = [];
  const { method, path, summary, requiresAuth, bodySchema, expectedCodes } = endpoint;

  // ── Shared positive building blocks ──────────────────────────────────────
  const pathParamValues = buildPositivePathParams(endpoint);
  const resolvedPath = interpolatePath(path, pathParamValues);
  const positiveQuery = buildPositiveQueryParams(endpoint);
  const positiveBody = bodySchema ? buildPositiveBody(bodySchema) : null;

  const authHeader = { Authorization: 'Bearer __ACCESS_TOKEN__' };
  const positiveStatus = expectedCodes.find(c => c >= 200 && c < 300) || 200;
  const urlFull = `${baseUrl}${resolvedPath}`;

  // ── 1. POSITIVE ───────────────────────────────────────────────────────────
  cases.push(makeCase({
    id: `${method}_${path}_positive`,
    type: 'positive',
    method,
    url: urlFull,
    headers: requiresAuth ? authHeader : {},
    queryParams: positiveQuery,
    body: positiveBody,
    expectedStatus: positiveStatus,
    description: `[+] ${summary || method + ' ' + path}`
  }));

  // ── 2. NEGATIVE: missing required body fields ─────────────────────────────
  if (bodySchema?.required?.length) {
    for (const requiredField of bodySchema.required) {
      const strippedBody = { ...positiveBody };
      delete strippedBody[requiredField];

      cases.push(makeCase({
        id: `${method}_${path}_neg_missing_${requiredField}`,
        type: 'negative',
        method,
        url: urlFull,
        headers: requiresAuth ? authHeader : {},
        queryParams: positiveQuery,
        body: strippedBody,
        expectedStatus: 400,
        description: `[-] Missing required field '${requiredField}' → 400`
      }));
    }
  }

  // ── 3. NEGATIVE: wrong type for first required field ─────────────────────
  if (bodySchema?.required?.length && positiveBody) {
    const field = bodySchema.required[0];
    const fieldSchema = bodySchema.properties?.[field];
    const wrongValue = fieldSchema?.type === 'string' ? 99999 : null; // flip type

    cases.push(makeCase({
      id: `${method}_${path}_neg_wrongtype_${field}`,
      type: 'negative',
      method,
      url: urlFull,
      headers: requiresAuth ? authHeader : {},
      queryParams: positiveQuery,
      body: { ...positiveBody, [field]: wrongValue },
      expectedStatus: 400,
      description: `[-] Wrong type for '${field}' (${typeof wrongValue}) → 400`
    }));
  }

  // ── 4. NEGATIVE: boundary — string minLength - 1 ─────────────────────────
  const stringFields = Object.entries(bodySchema?.properties || {})
    .filter(([, s]) => s.type === 'string' && s.minLength > 0);

  for (const [field, fieldSchema] of stringFields.slice(0, 2)) { // cap at 2
    const tooShort = 'x'.repeat(Math.max(0, fieldSchema.minLength - 1));
    cases.push(makeCase({
      id: `${method}_${path}_boundary_min_${field}`,
      type: 'boundary',
      method,
      url: urlFull,
      headers: requiresAuth ? authHeader : {},
      queryParams: positiveQuery,
      body: { ...positiveBody, [field]: tooShort },
      expectedStatus: 400,
      description: `[B] '${field}' below minLength(${fieldSchema.minLength}) → 400`
    }));

    if (fieldSchema.maxLength) {
      const tooLong = 'x'.repeat(fieldSchema.maxLength + 1);
      cases.push(makeCase({
        id: `${method}_${path}_boundary_max_${field}`,
        type: 'boundary',
        method,
        url: urlFull,
        headers: requiresAuth ? authHeader : {},
        queryParams: positiveQuery,
        body: { ...positiveBody, [field]: tooLong },
        expectedStatus: 400,
        description: `[B] '${field}' above maxLength(${fieldSchema.maxLength}) → 400`
      }));
    }
  }

  // ── 5. NEGATIVE: numeric boundary tests ──────────────────────────────────
  const numericFields = Object.entries(bodySchema?.properties || {})
    .filter(([, s]) => (s.type === 'integer' || s.type === 'number') && s.minimum !== undefined);

  for (const [field, fieldSchema] of numericFields.slice(0, 1)) {
    cases.push(makeCase({
      id: `${method}_${path}_boundary_numMin_${field}`,
      type: 'boundary',
      method,
      url: urlFull,
      headers: requiresAuth ? authHeader : {},
      queryParams: positiveQuery,
      body: { ...positiveBody, [field]: fieldSchema.minimum - 1 },
      expectedStatus: 400,
      description: `[B] '${field}' = minimum(${fieldSchema.minimum})-1 → 400`
    }));
  }

  // ── 6. NEGATIVE: invalid path param (expect 404) ─────────────────────────
  if (endpoint.pathParamNames.length > 0) {
    const invalidPathValues = { ...pathParamValues };
    const firstParam = endpoint.pathParamNames[0];
    invalidPathValues[firstParam] = 'NONEXISTENT_XYZ_999';
    const invalidUrl = `${baseUrl}${interpolatePath(path, invalidPathValues)}`;

    cases.push(makeCase({
      id: `${method}_${path}_neg_invalid_id`,
      type: 'negative',
      method,
      url: invalidUrl,
      headers: requiresAuth ? authHeader : {},
      queryParams: positiveQuery,
      body: positiveBody,
      expectedStatus: 404,
      description: `[-] Invalid path param '${firstParam}' → 404`
    }));
  }

  // ── 7. NEGATIVE: missing required query params ────────────────────────────
  const requiredQuery = endpoint.queryParams.filter(p => p.required);
  if (requiredQuery.length > 0) {
    cases.push(makeCase({
      id: `${method}_${path}_neg_missing_queryparam`,
      type: 'negative',
      method,
      url: urlFull,
      headers: requiresAuth ? authHeader : {},
      queryParams: {},   // strip all query params
      body: positiveBody,
      expectedStatus: 400,
      description: `[-] Missing required query params → 400`
    }));
  }

  // ── 8. AUTH: no token → 401 ───────────────────────────────────────────────
  if (requiresAuth) {
    cases.push(makeCase({
      id: `${method}_${path}_auth_no_token`,
      type: 'auth',
      method,
      url: urlFull,
      headers: {},       // no auth header
      queryParams: positiveQuery,
      body: positiveBody,
      expectedStatus: 401,
      description: `[A] No Authorization header → 401`
    }));

    // ── 9. AUTH: invalid token → 403 ───────────────────────────────────────
    cases.push(makeCase({
      id: `${method}_${path}_auth_bad_token`,
      type: 'auth',
      method,
      url: urlFull,
      headers: { Authorization: 'Bearer invalid.jwt.garbage' },
      queryParams: positiveQuery,
      body: positiveBody,
      expectedStatus: 403,
      description: `[A] Invalid/malformed JWT → 403`
    }));
  }

  return cases;
}

/**
 * Entry point: generate ALL test cases from a parsed endpoint list.
 * Returns a flat array of TestCase objects ordered by endpoint.
 */
function generateAllTestCases(endpoints, baseUrl = 'http://localhost:3000') {
  const all = [];
  for (const endpoint of endpoints) {
    const cases = generateCasesForEndpoint(endpoint, baseUrl);
    all.push(...cases);
  }
  return all;
}

module.exports = { generateAllTestCases, generateCasesForEndpoint, positiveValue, buildPositiveBody };
