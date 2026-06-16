// @ts-nocheck
import { SCHEMAS } from '../../../lib/schemas/walled.garden/index.js'

export default {
  validate(type, data) {
    const schema = SCHEMAS[type]
    if (!schema) {
      return { success: false, error: `Unknown schema type: ${type}` }
    }
    const result = schema.safeParse(data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return {
      success: false,
      error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    }
  },

  list() {
    return Object.keys(SCHEMAS)
  }
}
