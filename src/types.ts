export const PLATFORMS = ['linkedin', 'x', 'facebook', 'instagram'] as const;

export type Platform = (typeof PLATFORMS)[number];

export type Language = 'en' | 'ar';

/**
 * Lifecycle of a single platform-specific post. Nothing is sent to a live
 * account before it reaches `scheduled`, which requires an explicit approval.
 */
export const POST_STATUSES = [
  'draft',
  'pending_approval',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export interface MediaAsset {
  /** Publicly reachable HTTPS URL. Instagram cannot accept binary uploads. */
  url: string;
  kind: 'image' | 'video';
  altText?: string;
}

/** A rendered, ready-to-publish post for exactly one platform. */
export interface Post {
  id: string;
  campaignId: string;
  platform: Platform;
  language: Language;
  body: string;
  hashtags: string[];
  media: MediaAsset[];
  link?: string;
  /** UTC instant at which the post becomes eligible for publishing. */
  scheduledAt: string;
  status: PostStatus;
  attempts: number;
  /** Identifier returned by the platform, used to make retries idempotent. */
  platformPostId?: string;
  platformPostUrl?: string;
  lastError?: string;
  /** When a worker claimed the post for publishing. */
  claimedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  publishedAt?: string;
}

export interface PublishRequest {
  platform: Platform;
  /** Caption / body with hashtags already appended. */
  text: string;
  media: MediaAsset[];
  link?: string;
  /** Reference used for provider-side deduplication. */
  idempotencyKey: string;
}

export interface PublishResult {
  platformPostId: string;
  platformPostUrl?: string;
}

/** Thrown by publishers when a retry has a chance of succeeding. */
export class TransientPublishError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TransientPublishError';
  }
}

/** Thrown when the request itself is wrong; retrying cannot help. */
export class PermanentPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentPublishError';
  }
}

export interface Publisher {
  readonly name: string;
  supports(platform: Platform): boolean;
  publish(request: PublishRequest): Promise<PublishResult>;
}
