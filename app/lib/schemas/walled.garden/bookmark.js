import { z } from 'zod'

export const BookmarkSchema = z.object({
  type: z.literal('walled.garden/bookmark'),
  href: z.string().url().max(10000),
  title: z.string().max(280),
  description: z.string().max(560).optional(),
  tags: z.array(z.string().max(100).regex(/^[A-Za-z][A-Za-z0-9\-_?]*$/)).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
})
