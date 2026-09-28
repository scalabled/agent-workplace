import type { JsonSchema } from './types';

/**
 * Deterministic, schema-valid sample values (biz-bot mock: enums first, recursion bounded).
 * `text` seeds string fields so mock outputs echo the request.
 */
export function fillSchema(schema: JsonSchema | undefined, text = 'sample', depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  const variant = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (variant) return fillSchema(variant, text, depth + 1);
  const type = Array.isArray(schema.type) ? (schema.type.find((t) => t !== 'null') ?? schema.type[0]) : schema.type;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) out[key] = fillSchema(sub, key === 'reason' ? `Mock reason for: ${text}`.slice(0, 140) : text, depth + 1);
      return out;
    }
    case 'array': {
      const n = Math.max(1, schema.minItems ?? 1);
      return Array.from({ length: Math.min(n, schema.maxItems ?? n) }, () => fillSchema(schema.items, text, depth + 1));
    }
    case 'string':
      return text;
    case 'integer':
      return Math.ceil(schema.minimum ?? 1);
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return schema.properties ? fillSchema({ ...schema, type: 'object' }, text, depth) : text;
  }
}
