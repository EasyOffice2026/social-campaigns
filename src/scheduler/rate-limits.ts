import type { Platform } from '../types.js';

export interface RateLimit {
  /** Maximum publishes allowed inside the window. */
  max: number;
  windowMs: number;
  reason: string;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Publish ceilings we enforce ourselves. Instagram's is a hard platform limit;
 * the others are deliberately conservative so an automated campaign cannot run
 * away with the account (or, for X, with the per-post billing).
 */
export const RATE_LIMITS: Record<Platform, RateLimit> = {
  instagram: {
    max: 50,
    windowMs: DAY,
    reason: 'Instagram allows 50 API-published posts per rolling 24h',
  },
  linkedin: { max: 10, windowMs: DAY, reason: 'self-imposed guard against spamming the page' },
  facebook: { max: 10, windowMs: DAY, reason: 'self-imposed guard against spamming the page' },
  x: { max: 10, windowMs: DAY, reason: 'X bills per post (~$0.20 with a link)' },
};
