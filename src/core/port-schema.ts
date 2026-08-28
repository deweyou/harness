import * as z from 'zod/v4';
import { HarnessError, invariant } from './errors.js';
import type { PortSchema } from './types.js';

function compilePortSchema(schema: PortSchema, label: string): z.ZodType {
  try {
    return z.fromJSONSchema(schema);
  } catch (error) {
    throw new HarnessError(
      'INVALID_PORT_SCHEMA',
      `${label} is not a supported JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function assertPortSchema(schema: PortSchema, label: string): void {
  invariant(typeof schema.description === 'string' && schema.description.trim().length > 0, 'INVALID_PORT_SCHEMA', `${label}.description must be a non-empty string`);
  compilePortSchema(schema, label);
}

export function assertPortValue(schema: PortSchema, value: unknown, label: string): void {
  const parsed = compilePortSchema(schema, label).safeParse(value);
  if (!parsed.success) {
    throw new HarnessError('PORT_VALUE_MISMATCH', `${label} does not match its declared schema: ${z.prettifyError(parsed.error)}`);
  }
}

export function assertPortValues(
  ports: Record<string, PortSchema> | undefined,
  values: Record<string, unknown>,
  label: string,
): void {
  for (const [portId, schema] of Object.entries(ports ?? {})) {
    invariant(Object.hasOwn(values, portId), 'MISSING_PORT_VALUE', `${label} is missing declared port '${portId}'`);
    assertPortValue(schema, values[portId], `${label}.${portId}`);
  }
}
