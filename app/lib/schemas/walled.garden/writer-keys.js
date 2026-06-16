import { z } from 'zod'

export const WriterKeysSchema = z.object({
  type: z.literal('walled.garden/writer-keys'),
  keys: z.array(z.string())
})
