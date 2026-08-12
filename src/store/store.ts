import type { Platform, Post } from '../types.js';

export interface UpsertOutcome {
  created: string[];
  updated: string[];
  /** Ids skipped because the post is already live on a network. */
  unchangedPublished: string[];
}

export interface PostStore {
  /**
   * Writes planned posts. Already published posts are never touched, and a
   * content change on an approved post sends it back for approval.
   */
  upsertPlanned(posts: Post[]): Promise<UpsertOutcome>;
  listByCampaign(campaignId: string): Promise<Post[]>;
  approve(ids: string[], approver: string): Promise<Post[]>;
  /** Approved posts whose slot has arrived, oldest slot first. */
  due(now: Date, limit: number): Promise<Post[]>;
  /**
   * Atomically moves a post from `scheduled` to `publishing`. Returns false if
   * another worker got there first, which is what keeps a post from being sent
   * twice when more than one worker is running.
   */
  claim(post: Post): Promise<boolean>;
  /** Returns posts stuck in `publishing` (crashed worker) to the queue. */
  requeueStale(stuckSince: Date): Promise<number>;
  markPublished(
    id: string,
    result: { platformPostId: string; platformPostUrl?: string },
    publishedAt: Date,
  ): Promise<void>;
  markFailed(id: string, error: string, retry: boolean): Promise<void>;
  countPublishedSince(platform: Platform, since: Date): Promise<number>;
}

/** Fields that, when changed, invalidate an existing approval. */
export function contentFingerprint(post: Post): string {
  return JSON.stringify([post.body, post.media.map((asset) => asset.url), post.link ?? null]);
}
