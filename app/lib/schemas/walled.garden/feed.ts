import { z } from 'zod';

export const FeedSchema = z.object({
  type: z.literal('walled.garden/feed'),
  title: z.string().max(280),
  description: z.string().max(1000).optional(),
  author: z
    .object({
      url: z.url(),
    })
    .optional(),
  itemsPath: z.string().max(280).optional(),
  itemType: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
  icon: z.string().optional(),
  // Discovery vocabulary (ADR-0016). Mirrored here so Feed authors get editor autocomplete; the
  // canonical definitions live in the base index.json schema and apply to any drive type.
  indexable: z.boolean().optional(),
  topics: z.array(z.string().max(40)).max(5).optional(),
  keywords: z.array(z.string().max(40)).max(12).optional(),
});

export type Feed = z.infer<typeof FeedSchema>;
