import { z } from 'zod'

export const FeedSchema = z.object({
  type: z.literal('walled.garden/feed'),
  title: z.string().max(280),
  description: z.string().max(1000).optional(),
  author: z.object({
    url: z.url()
  }).optional(),
  itemsPath: z.string().max(280).optional(),
  itemType: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
  icon: z.string().optional()
})
