import { z } from 'zod';

export const PostSchema = z.object({
  type: z.literal('walled.garden/post'),
  title: z.string().max(280),
  summary: z.string().max(560).optional(),
  body: z.string().optional(),
  category: z.string().max(100).optional(),
  tags: z
    .array(
      z
        .string()
        .max(100)
        .regex(/^[A-Za-z][A-Za-z0-9\-_?]*$/)
    )
    .optional(),
  draft: z.boolean().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional(),
  author: z
    .object({
      url: z.url().nullish(),
      writerKey: z.string().optional(),
    })
    .optional(),
});

export type Post = z.infer<typeof PostSchema>;
