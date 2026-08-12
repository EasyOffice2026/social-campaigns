import type { Platform, Post } from '../types.js';
import { contentFingerprint, type PostStore, type UpsertOutcome } from './store.js';

/** In-process store used by tests and by `--dry-run` without a database. */
export class MemoryPostStore implements PostStore {
  private readonly posts = new Map<string, Post>();

  async upsertPlanned(posts: Post[]): Promise<UpsertOutcome> {
    const outcome: UpsertOutcome = { created: [], updated: [], unchangedPublished: [] };

    for (const planned of posts) {
      const existing = this.posts.get(planned.id);
      if (existing === undefined) {
        this.posts.set(planned.id, { ...planned });
        outcome.created.push(planned.id);
        continue;
      }
      if (existing.status === 'published') {
        outcome.unchangedPublished.push(planned.id);
        continue;
      }

      const changed = contentFingerprint(existing) !== contentFingerprint(planned);
      this.posts.set(planned.id, {
        ...existing,
        ...planned,
        status: changed ? 'pending_approval' : existing.status,
        ...(changed ? { approvedBy: undefined, approvedAt: undefined } : {}),
        attempts: changed ? 0 : existing.attempts,
      });
      outcome.updated.push(planned.id);
    }

    return outcome;
  }

  async listByCampaign(campaignId: string): Promise<Post[]> {
    return [...this.posts.values()]
      .filter((post) => post.campaignId === campaignId)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  async approve(ids: string[], approver: string): Promise<Post[]> {
    const approved: Post[] = [];
    for (const id of ids) {
      const post = this.posts.get(id);
      if (post === undefined || post.status !== 'pending_approval') continue;
      const next: Post = {
        ...post,
        status: 'scheduled',
        approvedBy: approver,
        approvedAt: new Date().toISOString(),
      };
      this.posts.set(id, next);
      approved.push(next);
    }
    return approved;
  }

  async due(now: Date, limit: number): Promise<Post[]> {
    return [...this.posts.values()]
      .filter((post) => post.status === 'scheduled' && post.scheduledAt <= now.toISOString())
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, limit);
  }

  async claim(candidate: Post): Promise<boolean> {
    const post = this.posts.get(candidate.id);
    if (post === undefined || post.status !== 'scheduled') return false;
    if (post.attempts !== candidate.attempts) return false;
    this.posts.set(post.id, {
      ...post,
      status: 'publishing',
      claimedAt: new Date().toISOString(),
      attempts: post.attempts + 1,
    });
    return true;
  }

  async requeueStale(stuckSince: Date): Promise<number> {
    const cutoff = stuckSince.toISOString();
    let requeued = 0;
    for (const post of this.posts.values()) {
      if (post.status !== 'publishing') continue;
      if (post.claimedAt !== undefined && post.claimedAt > cutoff) continue;
      this.posts.set(post.id, { ...post, status: 'scheduled' });
      requeued += 1;
    }
    return requeued;
  }

  async markPublished(
    id: string,
    result: { platformPostId: string; platformPostUrl?: string },
    publishedAt: Date,
  ): Promise<void> {
    const post = this.posts.get(id);
    if (post === undefined) return;
    this.posts.set(id, {
      ...post,
      status: 'published',
      platformPostId: result.platformPostId,
      ...(result.platformPostUrl !== undefined
        ? { platformPostUrl: result.platformPostUrl }
        : {}),
      publishedAt: publishedAt.toISOString(),
    });
  }

  async markFailed(id: string, error: string, retry: boolean): Promise<void> {
    const post = this.posts.get(id);
    if (post === undefined) return;
    this.posts.set(id, {
      ...post,
      status: retry ? 'scheduled' : 'failed',
      lastError: error,
    });
  }

  async countPublishedSince(platform: Platform, since: Date): Promise<number> {
    const cutoff = since.toISOString();
    return [...this.posts.values()].filter(
      (post) =>
        post.platform === platform &&
        post.status === 'published' &&
        post.publishedAt !== undefined &&
        post.publishedAt >= cutoff,
    ).length;
  }
}
