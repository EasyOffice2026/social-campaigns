import { describe, expect, it } from 'vitest';
import { parseBrief } from '../src/generate/brief.js';
import { generateCampaign } from '../src/generate/generate.js';
import { GenerationError, type TextGenerator } from '../src/generate/llm.js';
import { planCampaign } from '../src/planner.js';

const brief = parseBrief({
  campaignId: 'approve-q3',
  name: 'Approve Q3',
  brand: 'Approve',
  product: 'A cloud business management system for contracts, installments and HR in Kuwait.',
  audience: 'Owners of Kuwaiti trading companies',
  platforms: ['linkedin', 'x'],
  languages: ['en', 'ar'],
  postCount: 1,
  link: 'https://example.com/approve',
  hashtags: ['Kuwait'],
  cadence: { startDate: '2026-09-01', timesOfDay: ['09:30'] },
});

/** Replays canned model responses and records the prompts it was given. */
function fakeGenerator(replies: string[]): TextGenerator & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    name: 'fake',
    prompts,
    complete: async (prompt: string) => {
      prompts.push(prompt);
      const reply = replies[prompts.length - 1];
      if (reply === undefined) throw new Error('fake generator ran out of replies');
      return reply;
    },
  };
}

const good = JSON.stringify({
  content: [
    {
      key: 'installments',
      en: 'Installment schedules are generated from the contract, not typed by hand.',
      ar: 'جدول الأقساط يُنشأ من العقد تلقائيًا.',
      overrides: { x: { en: 'Installments generated from the contract.', ar: 'أقساط تلقائية.' } },
    },
  ],
});

describe('generateCampaign', () => {
  it('turns a brief plus model output into a campaign that plans cleanly', async () => {
    const generator = fakeGenerator([good]);

    const { campaign, attempts } = await generateCampaign(brief, generator);

    expect(attempts).toHaveLength(1);
    expect(campaign.id).toBe('approve-q3');
    expect(campaign.cadence.startDate).toBe('2026-09-01');
    expect(campaign.content[0]?.link).toBe('https://example.com/approve');
    expect(planCampaign(campaign).problems).toEqual([]);
  });

  it('puts the platform limits and the brief in the prompt', async () => {
    const generator = fakeGenerator([good]);

    await generateCampaign(brief, generator);

    const prompt = generator.prompts[0] ?? '';
    expect(prompt).toContain('max 280 characters');
    expect(prompt).toContain('Owners of Kuwaiti trading companies');
    expect(prompt).toContain('Languages required per post: en, ar');
  });

  it('feeds platform violations back to the model and keeps the repaired draft', async () => {
    const tooLongForX = JSON.stringify({
      content: [{ key: 'installments', en: 'x'.repeat(400), ar: 'ي'.repeat(400) }],
    });
    const generator = fakeGenerator([tooLongForX, good]);

    const { attempts, campaign } = await generateCampaign(brief, generator);

    expect(attempts[0]?.problems.length).toBeGreaterThan(0);
    expect(attempts[1]?.problems).toEqual([]);
    expect(generator.prompts[1]).toContain('limit is 280');
    expect(planCampaign(campaign).problems).toEqual([]);
  });

  it('gives up rather than writing content that would fail at publish time', async () => {
    const missingArabic = JSON.stringify({ content: [{ key: 'a', en: 'English only' }] });
    const generator = fakeGenerator([missingArabic, missingArabic]);

    await expect(generateCampaign(brief, generator, 2)).rejects.toBeInstanceOf(GenerationError);
  });

  it('tolerates a model that wraps its JSON in a markdown fence', async () => {
    const generator = fakeGenerator([`Here you go:\n\`\`\`json\n${good}\n\`\`\``]);

    const { campaign } = await generateCampaign(brief, generator);

    expect(campaign.content).toHaveLength(1);
  });

  it('rejects a reply with no JSON at all', async () => {
    const generator = fakeGenerator(['I cannot help with that.']);

    await expect(generateCampaign(brief, generator)).rejects.toThrow(/did not return JSON/);
  });
});
