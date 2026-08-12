import { describe, expect, it } from 'vitest';
import { FacebookPublisher } from '../src/publishers/facebook.js';
import { PermanentPublishError, TransientPublishError, type PublishRequest } from '../src/types.js';

function stub(status: number, json: unknown): { fetchImpl: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      json: async () => json,
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function publisher(fetchImpl: typeof fetch): FacebookPublisher {
  return new FacebookPublisher({
    pageAccessToken: 'page-token',
    pageId: '123',
    graphVersion: 'v21.0',
    fetchImpl,
  });
}

const request: PublishRequest = {
  platform: 'facebook',
  text: 'Approve keeps contracts in one place.',
  media: [],
  link: 'https://example.com/approve',
  idempotencyKey: 'demo:one:en:facebook',
};

describe('FacebookPublisher', () => {
  it('posts text and link to the page feed', async () => {
    const { fetchImpl, calls } = stub(200, { id: '123_456' });

    const result = await publisher(fetchImpl).publish(request);

    expect(result.platformPostId).toBe('123_456');
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/123/feed');
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get('message')).toBe(request.text);
    expect(body.get('link')).toBe('https://example.com/approve');
    expect(body.get('access_token')).toBe('page-token');
  });

  it('routes an image to /photos with the text as the caption', async () => {
    const { fetchImpl, calls } = stub(200, { post_id: '123_789', id: 'photo-1' });

    const result = await publisher(fetchImpl).publish({
      ...request,
      media: [{ url: 'https://cdn.example.com/a.png', kind: 'image' }],
    });

    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/123/photos');
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get('url')).toBe('https://cdn.example.com/a.png');
    expect(body.get('caption')).toBe(request.text);
    // post_id is the feed story; id is only the photo object.
    expect(result.platformPostId).toBe('123_789');
  });

  it('treats a graph error body as a failure even on HTTP 200', async () => {
    const { fetchImpl } = stub(200, { error: { message: 'Invalid OAuth token' } });

    await expect(publisher(fetchImpl).publish(request)).rejects.toBeInstanceOf(
      PermanentPublishError,
    );
  });

  it('retries a transient graph error', async () => {
    const { fetchImpl } = stub(500, { error: { message: 'temporary', is_transient: true } });

    await expect(publisher(fetchImpl).publish(request)).rejects.toBeInstanceOf(
      TransientPublishError,
    );
  });

  it('refuses video until it is implemented rather than posting something wrong', async () => {
    const { fetchImpl } = stub(200, { id: '1' });

    await expect(
      publisher(fetchImpl).publish({
        ...request,
        media: [{ url: 'https://cdn.example.com/a.mp4', kind: 'video' }],
      }),
    ).rejects.toThrow(/video publishing is not implemented/);
  });
});
