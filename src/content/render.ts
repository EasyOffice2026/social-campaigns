import type { Language, MediaAsset, Platform } from '../types.js';

export interface PlatformProfile {
  /** Maximum characters for body + hashtags combined. */
  maxLength: number;
  /** Recommended number of hashtags; more than this reads as spam. */
  maxHashtags: number;
  requiresMedia: boolean;
  /**
   * Whether the URL has to sit in the body text. False where the platform
   * renders its own preview card from the link (LinkedIn articles, Facebook
   * link posts), so repeating the URL in the copy would be noise.
   */
  appendsLinkToBody: boolean;
}

export const PLATFORM_PROFILES: Record<Platform, PlatformProfile> = {
  linkedin: {
    maxLength: 3000,
    maxHashtags: 5,
    requiresMedia: false,
    appendsLinkToBody: false,
  },
  x: {
    maxLength: 280,
    maxHashtags: 2,
    requiresMedia: false,
    appendsLinkToBody: true,
  },
  facebook: {
    maxLength: 63206,
    maxHashtags: 3,
    requiresMedia: false,
    appendsLinkToBody: false,
  },
  instagram: {
    maxLength: 2200,
    maxHashtags: 10,
    requiresMedia: true,
    appendsLinkToBody: false,
  },
};

export interface RenderInput {
  platform: Platform;
  language: Language;
  bodies: Partial<Record<Language, string>>;
  hashtags: string[];
  media: MediaAsset[];
  link?: string;
}

export interface RenderedContent {
  platform: Platform;
  language: Language;
  body: string;
  hashtags: string[];
  text: string;
  media: MediaAsset[];
  link?: string;
  warnings: string[];
}

export class ContentValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
    this.name = 'ContentValidationError';
  }
}

/**
 * Builds the exact text that will be sent to a platform, trimming the hashtag
 * set to what that network tolerates. Content that cannot fit is rejected
 * rather than silently truncated, so a campaign never publishes a half sentence.
 */
export function render(input: RenderInput): RenderedContent {
  const profile = PLATFORM_PROFILES[input.platform];
  const problems: string[] = [];
  const warnings: string[] = [];

  const body = input.bodies[input.language];
  if (body === undefined || body.trim() === '') {
    throw new ContentValidationError([
      `no ${input.language} copy for ${input.platform}`,
    ]);
  }

  if (profile.requiresMedia && input.media.length === 0) {
    problems.push(`${input.platform} requires at least one image or video`);
  }

  const hashtags = normaliseHashtags(input.hashtags);
  const kept = hashtags.slice(0, profile.maxHashtags);
  if (kept.length < hashtags.length) {
    warnings.push(
      `dropped ${hashtags.length - kept.length} hashtag(s) over the ${input.platform} limit of ${profile.maxHashtags}`,
    );
  }

  const includeLink = input.link !== undefined && profile.appendsLinkToBody;
  const text = [body.trim(), includeLink ? input.link : undefined, kept.join(' ')]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('\n\n');

  if (text.length > profile.maxLength) {
    problems.push(
      `${input.platform} copy is ${text.length} characters, limit is ${profile.maxLength}`,
    );
  }

  if (problems.length > 0) throw new ContentValidationError(problems);

  return {
    platform: input.platform,
    language: input.language,
    body: body.trim(),
    hashtags: kept,
    text,
    media: input.media,
    ...(input.link !== undefined ? { link: input.link } : {}),
    warnings,
  };
}

function normaliseHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, '');
    if (tag === '') continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${tag}`);
  }
  return out;
}
