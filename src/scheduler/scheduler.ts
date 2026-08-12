import type { PostStore } from '../store/store.js';
import {
  PermanentPublishError,
  TransientPublishError,
  type Post,
  type Publisher,
} from '../types.js';
import { RATE_LIMITS } from './rate-limits.js';

export interface SchedulerOptions {
  store: PostStore;
  publisher: Publisher;
  /** Attempts per post before it is parked as failed. */
  maxAttempts?: number;
  /** Posts examined per tick. */
  batchSize?: number;
  /** A claim older than this is assumed to belong to a dead worker. */
  staleClaimMs?: number;
  log?: (line: string) => void;
  now?: () => Date;
}

export interface TickResult {
  published: string[];
  retrying: string[];
  failed: string[];
  deferred: { id: string; reason: string }[];
  requeued: number;
}

export class Scheduler {
  private readonly maxAttempts: number;
  private readonly batchSize: number;
  private readonly staleClaimMs: number;
  private readonly log: (line: string) => void;
  private readonly now: () => Date;

  constructor(private readonly options: SchedulerOptions) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.batchSize = options.batchSize ?? 25;
    this.staleClaimMs = options.staleClaimMs ?? 15 * 60 * 1000;
    this.log = options.log ?? console.log;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Publishes every approved post whose slot has arrived. Safe to run
   * concurrently and safe to re-run: each post is claimed with a
   * compare-and-set, and a post already carrying a platform post id is skipped.
   */
  async tick(): Promise<TickResult> {
    const result: TickResult = {
      published: [],
      retrying: [],
      failed: [],
      deferred: [],
      requeued: 0,
    };

    result.requeued = await this.options.store.requeueStale(
      new Date(this.now().getTime() - this.staleClaimMs),
    );

    const due = await this.options.store.due(this.now(), this.batchSize);
    const publishedThisTick = new Map<string, number>();

    for (const post of due) {
      if (post.platformPostId !== undefined) {
        // Published earlier but the status write did not land; reconcile instead
        // of sending it a second time.
        await this.options.store.markPublished(
          post.id,
          { platformPostId: post.platformPostId },
          this.now(),
        );
        result.published.push(post.id);
        continue;
      }

      const overLimit = await this.wouldExceedRateLimit(post, publishedThisTick);
      if (overLimit !== undefined) {
        result.deferred.push({ id: post.id, reason: overLimit });
        this.log(`[scheduler] deferring ${post.id}: ${overLimit}`);
        continue;
      }

      if (!(await this.options.store.claim(post))) {
        result.deferred.push({ id: post.id, reason: 'claimed by another worker' });
        continue;
      }

      await this.publishClaimed(post, result, publishedThisTick);
    }

    return result;
  }

  private async publishClaimed(
    post: Post,
    result: TickResult,
    publishedThisTick: Map<string, number>,
  ): Promise<void> {
    const attempt = post.attempts + 1;
    try {
      const published = await this.options.publisher.publish({
        platform: post.platform,
        text: post.body,
        media: post.media,
        ...(post.link !== undefined ? { link: post.link } : {}),
        idempotencyKey: post.id,
      });
      await this.options.store.markPublished(post.id, published, this.now());
      publishedThisTick.set(post.platform, (publishedThisTick.get(post.platform) ?? 0) + 1);
      result.published.push(post.id);
      this.log(`[scheduler] published ${post.id} -> ${published.platformPostId}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof PermanentPublishError) && attempt < this.maxAttempts;
      await this.options.store.markFailed(post.id, message, retryable);
      if (retryable) {
        result.retrying.push(post.id);
        this.log(
          `[scheduler] attempt ${attempt}/${this.maxAttempts} failed for ${post.id}: ${message}`,
        );
      } else {
        result.failed.push(post.id);
        this.log(`[scheduler] giving up on ${post.id}: ${message}`);
      }
      if (error instanceof TransientPublishError && error.retryAfterMs !== undefined) {
        this.log(`[scheduler] provider asked to wait ${error.retryAfterMs}ms`);
      }
    }
  }

  /** Returns a reason when publishing now would break a platform ceiling. */
  private async wouldExceedRateLimit(
    post: Post,
    publishedThisTick: Map<string, number>,
  ): Promise<string | undefined> {
    const limit = RATE_LIMITS[post.platform];
    const since = new Date(this.now().getTime() - limit.windowMs);
    const alreadyPublished = await this.options.store.countPublishedSince(post.platform, since);
    const total = alreadyPublished + (publishedThisTick.get(post.platform) ?? 0);
    if (total >= limit.max) {
      return `${post.platform} rate limit reached (${total}/${limit.max}) - ${limit.reason}`;
    }
    return undefined;
  }
}
