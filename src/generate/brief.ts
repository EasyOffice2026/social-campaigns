import { z } from 'zod';
import { PLATFORMS } from '../types.js';

export const briefSchema = z.object({
  /** Becomes the campaign id, so keep it stable across regenerations. */
  campaignId: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  /** What is being marketed, in plain prose. The more concrete, the better. */
  product: z.string().min(20),
  audience: z.string().min(5),
  /** e.g. "confident, practical, no hype; write for busy business owners". */
  tone: z.string().min(3).default('practical and confident, no marketing hype'),
  /** Concrete benefits to draw from; the model should not invent features. */
  valueProps: z.array(z.string().min(3)).default([]),
  callToAction: z.string().min(3).default('Book a demo'),
  link: z.string().url().optional(),
  hashtags: z.array(z.string()).default([]),
  languages: z.array(z.enum(['en', 'ar'])).min(1).default(['en']),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  /** How many distinct pieces of content to write. */
  postCount: z.number().int().min(1).max(30).default(6),
  timezone: z.string().min(1).default('Asia/Kuwait'),
  cadence: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    everyDays: z.number().int().min(1).default(2),
    timesOfDay: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).default(['09:30']),
  }),
  /** Claims, numbers or phrases that must appear verbatim. */
  mustInclude: z.array(z.string()).default([]),
  /** Words, claims or topics the copy must stay away from. */
  avoid: z.array(z.string()).default([]),
});

export type Brief = z.infer<typeof briefSchema>;

export function parseBrief(input: unknown): Brief {
  return briefSchema.parse(input);
}
