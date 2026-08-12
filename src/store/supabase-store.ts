import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MediaAsset, Platform, Post, PostStatus } from '../types.js';
import { contentFingerprint, type PostStore, type UpsertOutcome } from './store.js';

const TABLE = 'mkt_posts';

interface PostRow {
  id: string;
  campaign_id: string;
  platform: Platform;
  language: 'en' | 'ar';
  body: string;
  hashtags: string[] | null;
  media: MediaAsset[] | null;
  link: string | null;
  scheduled_at: string;
  status: PostStatus;
  attempts: number;
  platform_post_id: string | null;
  platform_post_url: string | null;
  last_error: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  claimed_at: string | null;
}

/**
 * Supabase-backed store. The queue lives in Postgres rather than in the worker
 * process so a restart mid-campaign cannot lose or double-send a slot.
 */
export class SupabasePostStore implements PostStore {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  async upsertPlanned(posts: Post[]): Promise<UpsertOutcome> {
    const outcome: UpsertOutcome = { created: [], updated: [], unchangedPublished: [] };
    if (posts.length === 0) return outcome;

    const existing = await this.fetchMany(posts.map((post) => post.id));
    const rows: PostRow[] = [];

    for (const planned of posts) {
      const current = existing.get(planned.id);
      if (current === undefined) {
        rows.push(toRow(planned));
        outcome.created.push(planned.id);
        continue;
      }
      if (current.status === 'published') {
        outcome.unchangedPublished.push(planned.id);
        continue;
      }

      const changed = contentFingerprint(current) !== contentFingerprint(planned);
      rows.push(
        toRow({
          ...current,
          ...planned,
          status: changed ? 'pending_approval' : current.status,
          attempts: changed ? 0 : current.attempts,
          ...(changed ? { approvedBy: undefined, approvedAt: undefined } : {}),
        }),
      );
      outcome.updated.push(planned.id);
    }

    if (rows.length > 0) {
      const { error } = await this.client.from(TABLE).upsert(rows, { onConflict: 'id' });
      if (error !== null) throw new Error(`upsert failed: ${error.message}`);
    }
    return outcome;
  }

  async listByCampaign(campaignId: string): Promise<Post[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('campaign_id', campaignId)
      .order('scheduled_at', { ascending: true });
    if (error !== null) throw new Error(`list failed: ${error.message}`);
    return (data as PostRow[]).map(fromRow);
  }

  async approve(ids: string[], approver: string): Promise<Post[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client
      .from(TABLE)
      .update({
        status: 'scheduled',
        approved_by: approver,
        approved_at: new Date().toISOString(),
      })
      .in('id', ids)
      .eq('status', 'pending_approval')
      .select('*');
    if (error !== null) throw new Error(`approve failed: ${error.message}`);
    return (data as PostRow[]).map(fromRow);
  }

  async due(now: Date, limit: number): Promise<Post[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', now.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(limit);
    if (error !== null) throw new Error(`due query failed: ${error.message}`);
    return (data as PostRow[]).map(fromRow);
  }

  async markPublished(
    id: string,
    result: { platformPostId: string; platformPostUrl?: string },
    publishedAt: Date,
  ): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update({
        status: 'published',
        platform_post_id: result.platformPostId,
        platform_post_url: result.platformPostUrl ?? null,
        published_at: publishedAt.toISOString(),
      })
      .eq('id', id);
    if (error !== null) throw new Error(`markPublished failed: ${error.message}`);
  }

  async markFailed(id: string, message: string, retry: boolean): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update({ status: retry ? 'scheduled' : 'failed', last_error: message })
      .eq('id', id);
    if (error !== null) throw new Error(`markFailed failed: ${error.message}`);
  }

  async countPublishedSince(platform: Platform, since: Date): Promise<number> {
    const { count, error } = await this.client
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('platform', platform)
      .eq('status', 'published')
      .gte('published_at', since.toISOString());
    if (error !== null) throw new Error(`count failed: ${error.message}`);
    return count ?? 0;
  }

  async claim(post: Post): Promise<boolean> {
    // The status and attempts predicates make this a compare-and-set: only one
    // worker can flip a given row, so a slot is published at most once.
    const { data, error } = await this.client
      .from(TABLE)
      .update({
        status: 'publishing',
        claimed_at: new Date().toISOString(),
        attempts: post.attempts + 1,
      })
      .eq('id', post.id)
      .eq('status', 'scheduled')
      .eq('attempts', post.attempts)
      .select('id');
    if (error !== null) throw new Error(`claim failed: ${error.message}`);
    return (data as { id: string }[]).length === 1;
  }

  async requeueStale(stuckSince: Date): Promise<number> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({ status: 'scheduled' })
      .eq('status', 'publishing')
      .lte('claimed_at', stuckSince.toISOString())
      .select('id');
    if (error !== null) throw new Error(`requeueStale failed: ${error.message}`);
    return (data as { id: string }[]).length;
  }

  private async fetchMany(ids: string[]): Promise<Map<string, Post>> {
    const { data, error } = await this.client.from(TABLE).select('*').in('id', ids);
    if (error !== null) throw new Error(`fetch failed: ${error.message}`);
    return new Map((data as PostRow[]).map((row) => [row.id, fromRow(row)]));
  }
}

function toRow(post: Post): PostRow {
  return {
    id: post.id,
    campaign_id: post.campaignId,
    platform: post.platform,
    language: post.language,
    body: post.body,
    hashtags: post.hashtags,
    media: post.media,
    link: post.link ?? null,
    scheduled_at: post.scheduledAt,
    status: post.status,
    attempts: post.attempts,
    platform_post_id: post.platformPostId ?? null,
    platform_post_url: post.platformPostUrl ?? null,
    last_error: post.lastError ?? null,
    approved_by: post.approvedBy ?? null,
    approved_at: post.approvedAt ?? null,
    published_at: post.publishedAt ?? null,
    claimed_at: post.claimedAt ?? null,
  };
}

function fromRow(row: PostRow): Post {
  const post: Post = {
    id: row.id,
    campaignId: row.campaign_id,
    platform: row.platform,
    language: row.language,
    body: row.body,
    hashtags: row.hashtags ?? [],
    media: row.media ?? [],
    scheduledAt: row.scheduled_at,
    status: row.status,
    attempts: row.attempts,
  };
  if (row.link !== null) post.link = row.link;
  if (row.platform_post_id !== null) post.platformPostId = row.platform_post_id;
  if (row.platform_post_url !== null) post.platformPostUrl = row.platform_post_url;
  if (row.last_error !== null) post.lastError = row.last_error;
  if (row.approved_by !== null) post.approvedBy = row.approved_by;
  if (row.approved_at !== null) post.approvedAt = row.approved_at;
  if (row.published_at !== null) post.publishedAt = row.published_at;
  if (row.claimed_at !== null) post.claimedAt = row.claimed_at;
  return post;
}
