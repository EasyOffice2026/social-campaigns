import { describe, expect, it } from 'vitest';
import { ContentValidationError, render } from '../src/content/render.js';

const bodies = { en: 'Approve keeps contracts and installments in one place.', ar: 'مرحبا' };

describe('render', () => {
  it('appends the link and hashtags for platforms that need them inline', () => {
    const result = render({
      platform: 'linkedin',
      language: 'en',
      bodies,
      hashtags: ['Kuwait', 'ERP'],
      media: [],
      link: 'https://example.com/approve',
    });

    expect(result.text).toContain('https://example.com/approve');
    expect(result.text).toContain('#Kuwait #ERP');
  });

  it('omits the inline link where the platform renders its own preview', () => {
    const result = render({
      platform: 'facebook',
      language: 'en',
      bodies,
      hashtags: [],
      media: [],
      link: 'https://example.com/approve',
    });

    expect(result.text).not.toContain('https://example.com/approve');
    expect(result.link).toBe('https://example.com/approve');
  });

  it('trims hashtags to the per-platform maximum and reports it', () => {
    const result = render({
      platform: 'x',
      language: 'en',
      bodies,
      hashtags: ['a', 'b', 'c', 'd'],
      media: [],
    });

    expect(result.hashtags).toEqual(['#a', '#b']);
    expect(result.warnings[0]).toMatch(/dropped 2 hashtag/);
  });

  it('deduplicates hashtags case-insensitively and normalises the hash', () => {
    const result = render({
      platform: 'linkedin',
      language: 'en',
      bodies,
      hashtags: ['#Kuwait', 'kuwait', ' ERP '],
      media: [],
    });

    expect(result.hashtags).toEqual(['#Kuwait', '#ERP']);
  });

  it('rejects copy that exceeds the platform limit instead of truncating', () => {
    expect(() =>
      render({
        platform: 'x',
        language: 'en',
        bodies: { en: 'x'.repeat(300) },
        hashtags: [],
        media: [],
      }),
    ).toThrow(ContentValidationError);
  });

  it('rejects an Instagram post with no media', () => {
    expect(() =>
      render({ platform: 'instagram', language: 'en', bodies, hashtags: [], media: [] }),
    ).toThrow(/requires at least one image or video/);
  });

  it('rejects a language the content has no copy for', () => {
    expect(() =>
      render({
        platform: 'linkedin',
        language: 'ar',
        bodies: { en: 'english only' },
        hashtags: [],
        media: [],
      }),
    ).toThrow(/no ar copy/);
  });
});
