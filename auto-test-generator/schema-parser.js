/**
 * schema-parser.js
 * Reads an OpenAPI 3.x spec and returns a structured endpoint map
 * with full schema info: parameters, request body shape, response codes, constraints.
 */

'use strict';

/**
 * Resolve a $ref like "#/components/schemas/Booking" from the spec.
 */
function resolveRef(ref, spec) {
  if (!ref || !ref.startsWith('#/')) return null;
  const parts = ref.replace('#/', '').split('/');
  return parts.reduce((obj, key) => obj?.[key], spec) || null;
}

/**
 * Fully dereference a schema node (handles $ref, allOf, oneOf, nested objects).
 * Returns a plain schema object with no $ref left.
 */
function dereferenceSchema(schema, spec, depth = 0) {
  if (!schema || depth > 6) return schema;

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec);
    return dereferenceSchema(resolved, spec, depth + 1);
  }

  if (schema.allOf) {
    return schema.allOf.reduce(
      (merged, s) => ({ ...merged, ...dereferenceSchema(s, spec, depth + 1) }),
      {}
    );
  }

  if (schema.oneOf || schema.anyOf) {
    return dereferenceSchema((schema.oneOf || schema.anyOf)[0], spec, depth + 1);
  }

  if (schema.type === 'object' || schema.properties) {
    const props = {};
    for (const [key, val] of Object.entries(schema.properties || {})) {
      props[key] = dereferenceSchema(val, spec, depth + 1);
    }
    return { ...schema, properties: props };
  }

  if (schema.type === 'array' && schema.items) {
    return { ...schema, items: dereferenceSchema(schema.items, spec, depth + 1) };
  }

  return schema;
}

/**
 * Extract the JSON body schema from a requestBody definition.
 */
function extractBodySchema(requestBody, spec) {
  if (!requestBody) return null;
  const content = requestBody.content || {};
  const jsonContent = content['application/json'];
  if (!jsonContent?.schema) return null;
  return dereferenceSchema(jsonContent.schema, spec);
}

/**
 * Parse all path parameters from a path string (e.g. /api/flights/{id} → ['id'])
 */
function extractPathParamNames(path) {
  const matches = path.match(/\{(\w+)\}/g) || [];
  return matches.map(m => m.slice(1, -1));
}

/**
 * Build the endpoint map from an OpenAPI spec.
 *
 * Returns an array of endpoint descriptors, each containing:
 *   method, path, summary, tags, requiresAuth,
 *   pathParams, queryParams, bodySchema, expectedCodes
 */
function parseSpec(spec) {
  const globalAuth = !!(spec.security?.length);
  const endpoints = [];

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

      // Auth: operation-level security overrides global
      const hasSecurityKey = Object.prototype.hasOwnProperty.call(operation, 'security');
      const requiresAuth = hasSecurityKey
        ? operation.security?.length > 0
        : globalAuth;

      // Parameters: path + query
      const allParams = operation.parameters || [];
      const pathParams = allParams
        .filter(p => p.in === 'path')
        .map(p => ({ name: p.name, schema: dereferenceSchema(p.schema || {}, spec), required: p.required !== false }));
      const queryParams = allParams
        .filter(p => p.in === 'query')
        .map(p => ({ name: p.name, schema: dereferenceSchema(p.schema || {}, spec), required: !!p.required, example: p.example }));

      // Body
      const bodySchema = extractBodySchema(operation.requestBody, spec);
      const bodyRequired = !!operation.requestBody?.required;

      // Expected response codes (numbers)
      const expectedCodes = Object.keys(operation.responses || {})
        .map(Number)
        .filter(n => !isNaN(n));

      endpoints.push({
        operationId: operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        method: method.toUpperCase(),
        path,
        summary: operation.summary || '',
        tags: operation.tags || [],
        requiresAuth,
        pathParamNames: extractPathParamNames(path),
        pathParams,
        queryParams,
        bodySchema,
        bodyRequired,
        expectedCodes
      });
    }
  }

  return endpoints;
}

module.exports = { parseSpec, dereferenceSchema, resolveRef };
