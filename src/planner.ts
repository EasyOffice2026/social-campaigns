import type { Campaign, CampaignContent } from './campaign.js';
import { render, type RenderedContent } from './content/render.js';
import { addDays, zonedWallClockToUtc } from './time.js';
import type { Language, Platform, Post } from './types.js';

export interface PlannedPost extends Post {
  contentKey: string;
  warnings: string[];
}

export interface PlanProblem {
  contentKey: string;
  platform: Platform;
  language: Language;
  problems: string[];
}

export interface Plan {
  posts: PlannedPost[];
  problems: PlanProblem[];
}

/**
 * Expands a campaign into one post per (content x language x platform), laying
 * the content pieces onto the cadence slots in order. Post ids are derived from
 * the campaign so re-planning is idempotent: an unchanged campaign yields the
 * same ids and the store keeps the existing approval state.
 */
export function planCampaign(campaign: Campaign): Plan {
  const posts: PlannedPost[] = [];
  const problems: PlanProblem[] = [];

  let slotIndex = 0;
  for (const content of campaign.content) {
    for (const language of campaign.languages) {
      const scheduledAt = slotAt(campaign, slotIndex).toISOString();
      slotIndex += 1;

      for (const platform of campaign.platforms) {
        let rendered: RenderedContent;
        try {
          rendered = render({
            platform,
            language,
            bodies: bodiesOf(content, platform),
            hashtags: content.hashtags ?? campaign.hashtags,
            media: content.media,
            ...(content.link !== undefined ? { link: content.link } : {}),
          });
        } catch (error) {
          problems.push({
            contentKey: content.key,
            platform,
            language,
            problems: problemsOf(error),
          });
          continue;
        }

        posts.push({
          id: postId(campaign.id, content.key, language, platform),
          campaignId: campaign.id,
          contentKey: content.key,
          platform,
          language,
          body: rendered.text,
          hashtags: rendered.hashtags,
          media: rendered.media,
          ...(rendered.link !== undefined ? { link: rendered.link } : {}),
          scheduledAt,
          status: 'pending_approval',
          attempts: 0,
          warnings: rendered.warnings,
        });
      }
    }
  }

  return { posts, problems };
}

export function postId(
  campaignId: string,
  contentKey: string,
  language: Language,
  platform: Platform,
): string {
  return `${campaignId}:${contentKey}:${language}:${platform}`;
}

function bodiesOf(
  content: CampaignContent,
  platform: Platform,
): Partial<Record<Language, string>> {
  const override = content.overrides?.[platform] ?? {};
  const bodies: Partial<Record<Language, string>> = { en: override.en ?? content.en };
  const ar = override.ar ?? content.ar;
  if (ar !== undefined) bodies.ar = ar;
  return bodies;
}

function slotAt(campaign: Campaign, index: number): Date {
  const times = campaign.cadence.timesOfDay;
  const perDay = times.length;
  const dayOffset = Math.floor(index / perDay) * campaign.cadence.everyDays;
  const timeOfDay = times[index % perDay];
  if (timeOfDay === undefined) throw new Error('campaign has no cadence times');
  return zonedWallClockToUtc(
    addDays(campaign.cadence.startDate, dayOffset),
    timeOfDay,
    campaign.timezone,
  );
}

function problemsOf(error: unknown): string[] {
  if (error instanceof Error && 'problems' in error && Array.isArray(error.problems)) {
    return error.problems.filter((item): item is string => typeof item === 'string');
  }
  return [error instanceof Error ? error.message : String(error)];
}
