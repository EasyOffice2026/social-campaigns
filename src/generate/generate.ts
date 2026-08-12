import { z } from 'zod';
import { campaignSchema, parseCampaign, type Campaign } from '../campaign.js';
import { PLATFORM_PROFILES } from '../content/render.js';
import { planCampaign, type PlanProblem } from '../planner.js';
import type { Brief } from './brief.js';
import { GenerationError, type TextGenerator } from './llm.js';

const draftSchema = z.object({
  content: z
    .array(
      z.object({
        key: z.string().min(1),
        en: z.string().min(1),
        ar: z.string().min(1).optional(),
        hashtags: z.array(z.string()).optional(),
        overrides: z
          .record(z.enum(['linkedin', 'x', 'facebook', 'instagram']), z.object({
            en: z.string().min(1).optional(),
            ar: z.string().min(1).optional(),
          }))
          .optional(),
      }),
    )
    .min(1),
});

export interface GenerateResult {
  campaign: Campaign;
  /** One entry per model round trip, for seeing what had to be repaired. */
  attempts: { problems: PlanProblem[] }[];
}

const SYSTEM = `You are a B2B social media copywriter. You write posts that a real
business owner would stop to read: concrete, specific, no filler, no hype, no
emoji spam. You never invent product features, customers, prices or statistics
that were not given to you. When writing Arabic you write natively in Modern
Standard Arabic as a native speaker would - never a literal translation of the
English. You reply with JSON only, no prose, no markdown fences.`;

/**
 * Drafts campaign content from a brief, then validates it exactly as `plan`
 * would. When a post breaks a platform rule (X over 280 characters, missing
 * Arabic copy) the failures are fed back to the model to repair, so what lands
 * on disk is already publishable rather than a draft that fails later.
 */
export async function generateCampaign(
  brief: Brief,
  generator: TextGenerator,
  maxAttempts = 3,
): Promise<GenerateResult> {
  const attempts: { problems: PlanProblem[] }[] = [];
  let feedback: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const raw = await generator.complete(buildPrompt(brief, feedback), SYSTEM);
    const draft = draftSchema.parse(JSON.parse(extractJson(raw)));

    const campaign = parseCampaign({
      id: brief.campaignId,
      name: brief.name,
      timezone: brief.timezone,
      languages: brief.languages,
      platforms: brief.platforms,
      hashtags: brief.hashtags,
      cadence: brief.cadence,
      content: draft.content.map((item) => ({
        ...item,
        ...(brief.link !== undefined ? { link: brief.link } : {}),
      })),
    } satisfies z.input<typeof campaignSchema>);

    const { problems } = planCampaign(campaign);
    attempts.push({ problems });

    if (problems.length === 0) {
      return { campaign, attempts };
    }

    feedback = problems
      .map(
        (problem) =>
          `- content "${problem.contentKey}" for ${problem.platform} (${problem.language}): ${problem.problems.join('; ')}`,
      )
      .join('\n');
  }

  throw new GenerationError(
    `content still breaks platform rules after ${maxAttempts} attempts:\n${feedback ?? ''}`,
  );
}

function buildPrompt(brief: Brief, feedback: string | undefined): string {
  const limits = brief.platforms
    .map((platform) => {
      const profile = PLATFORM_PROFILES[platform];
      return `- ${platform}: max ${profile.maxLength} characters including hashtags, at most ${profile.maxHashtags} hashtags${profile.requiresMedia ? ', requires an image (do not target it without media)' : ''}`;
    })
    .join('\n');

  const sections = [
    `Write ${brief.postCount} distinct social posts for a marketing campaign.`,
    `Brand: ${brief.brand}`,
    `Product: ${brief.product}`,
    `Audience: ${brief.audience}`,
    `Tone: ${brief.tone}`,
    brief.valueProps.length > 0
      ? `Only draw on these benefits:\n${brief.valueProps.map((value) => `- ${value}`).join('\n')}`
      : undefined,
    `Call to action: ${brief.callToAction}`,
    brief.mustInclude.length > 0
      ? `Every post must include: ${brief.mustInclude.join('; ')}`
      : undefined,
    brief.avoid.length > 0 ? `Never mention: ${brief.avoid.join('; ')}` : undefined,
    `Languages required per post: ${brief.languages.join(', ')}`,
    `Platform limits:\n${limits}`,
    `Rules:
- Each post covers a different angle; do not restate the same sentence.
- Do not put the link in the copy, it is added automatically.
- Hashtags go in the "hashtags" array, never inside the body text.
- Where one body cannot satisfy every platform (X is only ${PLATFORM_PROFILES.x.maxLength} characters), put the shorter version in "overrides".
- "key" is a short stable slug, lowercase, hyphenated, unique per post.`,
    `Reply with this JSON shape only:
{"content":[{"key":"slug","en":"English body","ar":"Arabic body","hashtags":["Kuwait"],"overrides":{"x":{"en":"short English","ar":"short Arabic"}}}]}`,
    feedback !== undefined
      ? `Your previous attempt broke these rules. Rewrite ALL posts, fixing them:\n${feedback}`
      : undefined,
  ];

  return sections.filter((section): section is string => section !== undefined).join('\n\n');
}

/** Models still wrap JSON in prose or fences often enough to handle it here. */
function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new GenerationError(`model did not return JSON: ${candidate.slice(0, 200)}`);
  }
  return candidate.slice(start, end + 1);
}
