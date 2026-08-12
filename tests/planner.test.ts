import { describe, expect, it } from 'vitest';
import { parseCampaign } from '../src/campaign.js';
import { planCampaign } from '../src/planner.js';

const campaign = parseCampaign({
  id: 'demo',
  name: 'Demo',
  timezone: 'Asia/Kuwait',
  languages: ['en', 'ar'],
  platforms: ['linkedin', 'facebook'],
  hashtags: ['Kuwait'],
  cadence: { startDate: '2026-09-01', everyDays: 2, timesOfDay: ['09:30', '19:00'] },
  content: [
    { key: 'one', en: 'first piece of copy', ar: 'النسخة الأولى' },
    { key: 'two', en: 'second piece of copy', ar: 'النسخة الثانية' },
  ],
});

describe('planCampaign', () => {
  it('creates one post per content x language x platform', () => {
    const { posts, problems } = planCampaign(campaign);
    expect(problems).toEqual([]);
    expect(posts).toHaveLength(2 * 2 * 2);
    expect(posts.every((post) => post.status === 'pending_approval')).toBe(true);
  });

  it('lays slots onto the cadence in Kuwait local time (UTC+3, no DST)', () => {
    const { posts } = planCampaign(campaign);
    const slots = [...new Set(posts.map((post) => post.scheduledAt))].sort();

    expect(slots).toEqual([
      '2026-09-01T06:30:00.000Z',
      '2026-09-01T16:00:00.000Z',
      '2026-09-03T06:30:00.000Z',
      '2026-09-03T16:00:00.000Z',
    ]);
  });

  it('gives every post a stable id so replanning is idempotent', () => {
    const first = planCampaign(campaign).posts.map((post) => post.id);
    const second = planCampaign(campaign).posts.map((post) => post.id);
    expect(second).toEqual(first);
    expect(first).toContain('demo:one:ar:linkedin');
  });

  it('reports unpublishable combinations without dropping the rest', () => {
    const withInstagram = parseCampaign({
      ...campaign,
      platforms: ['linkedin', 'instagram'],
    });
    const { posts, problems } = planCampaign(withInstagram);

    expect(problems).toHaveLength(4);
    expect(problems[0]?.platform).toBe('instagram');
    expect(posts.every((post) => post.platform === 'linkedin')).toBe(true);
  });
});
