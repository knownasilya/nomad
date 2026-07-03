import { z } from 'zod'

export const PersonSchema = z.object({
  type: z.literal('walled.garden/person'),
  title: z.string().max(280),
  description: z.string().max(1000).optional(),
  thumb: z.string().optional(),
  links: z.array(z.object({
    label: z.string().max(100),
    href: z.url()
  })).optional()
})

export type Person = z.infer<typeof PersonSchema>
