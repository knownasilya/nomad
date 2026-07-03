import { SCHEMAS } from '../../../lib/schemas/walled.garden';
import type { SchemaType, WalledGardenRecord } from '../../../lib/schemas/walled.garden';

export type ValidateResult =
  | { success: true; data: WalledGardenRecord }
  | { success: false; error: string };

export default {
  validate(type: string, data: unknown): ValidateResult {
    const schema = (SCHEMAS as Record<string, (typeof SCHEMAS)[SchemaType]>)[type];
    if (!schema) {
      return { success: false, error: `Unknown schema type: ${type}` };
    }
    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return {
      success: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  },

  list(): SchemaType[] {
    return Object.keys(SCHEMAS) as SchemaType[];
  },
};
