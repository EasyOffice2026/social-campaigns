import { z } from 'zod';
import { PLATFORMS } from './types.js';

const mediaSchema = z.object({
  url: z.string().url().startsWith('https://', 'media must be served over HTTPS'),
  kind: z.enum(['image', 'video']),
  altText: z.string().max(1000).optional(),
});

const contentSchema = z.object({
  /** Stable key so re-planning a campaign does not duplicate posts. */
  key: z.string().min(1),
  en: z.string().min(1),
  ar: z.string().min(1).optional(),
  link: z.string().url().optional(),
  media: z.array(mediaSchema).default([]),
  /** Overrides the campaign-level hashtag set for this piece of content. */
  hashtags: z.array(z.string()).optional(),
});

export const campaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** IANA timezone the cadence times are expressed in, e.g. Asia/Kuwait. */
  timezone: z.string().min(1).default('Asia/Kuwait'),
  languages: z.array(z.enum(['en', 'ar'])).min(1).default(['en']),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  hashtags: z.array(z.string()).default([]),
  cadence: z.object({
    /** ISO date (YYYY-MM-DD) of the first slot. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Days between consecutive slots. */
    everyDays: z.number().int().min(1).default(1),
    /** Local times of day for each slot, HH:MM in 24h form. */
    timesOfDay: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1),
  }),
  content: z.array(contentSchema).min(1),
});

export type Campaign = z.infer<typeof campaignSchema>;
export type CampaignContent = z.infer<typeof contentSchema>;

export function parseCampaign(input: unknown): Campaign {
  return campaignSchema.parse(input);
}
