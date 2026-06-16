import { z } from 'zod'

export const PostSchema = z.object({
  type: z.literal('walled.garden/post'),
  title: z.string().max(280),
  body: z.string(),
  category: z.string().max(100).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional(),
  author: z.object({
    url: z.url().nullish(),
    writerKey: z.string().optional()
  }).optional()
})
