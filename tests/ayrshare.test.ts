import { describe, expect, it } from 'vitest';
import { AyrsharePublisher } from '../src/publishers/ayrshare.js';
import { PermanentPublishError, TransientPublishError, type PublishRequest } from '../src/types.js';

const request: PublishRequest = {
  platform: 'x',
  text: 'hello Kuwait',
  media: [{ url: 'https://cdn.example.com/a.png', kind: 'image' }],
  idempotencyKey: 'demo:one:en:x',
};

function publisherWith(
  status: number,
  body: unknown,
): { publisher: AyrsharePublisher; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      json: async () => body,
    };
  }) as unknown as typeof fetch;

  return {
    publisher: new AyrsharePublisher({ apiKey: 'key-123', fetchImpl }),
    calls,
  };
}

describe('AyrsharePublisher', () => {
  it('maps our platform key to Ayrshare\'s and returns the post id', async () => {
    const { publisher, calls } = publisherWith(200, {
      status: 'success',
      postIds: [{ platform: 'twitter', id: 'tw-1', postUrl: 'https://x.com/p/1' }],
    });

    const result = await publisher.publish(request);

    expect(result).toEqual({ platformPostId: 'tw-1', platformPostUrl: 'https://x.com/p/1' });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.platforms).toEqual(['twitter']);
    expect(body.mediaUrls).toEqual(['https://cdn.example.com/a.png']);
  });

  it('sends the post id as an idempotency key so a retry cannot double-post', async () => {
    const { publisher, calls } = publisherWith(200, {
      postIds: [{ platform: 'twitter', id: 'tw-1' }],
    });

    await publisher.publish(request);

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('demo:one:en:x');
    expect(headers.Authorization).toBe('Bearer key-123');
  });

  it('treats 429 and 5xx as retryable', async () => {
    for (const status of [429, 500, 503]) {
      const { publisher } = publisherWith(status, { message: 'slow down' });
      await expect(publisher.publish(request)).rejects.toBeInstanceOf(TransientPublishError);
    }
  });

  it('treats a 4xx rejection as permanent', async () => {
    const { publisher } = publisherWith(400, { errors: [{ message: 'caption too long' }] });
    await expect(publisher.publish(request)).rejects.toBeInstanceOf(PermanentPublishError);
  });

  it('fails rather than reporting success when no post id comes back', async () => {
    const { publisher } = publisherWith(200, { status: 'success', postIds: [] });
    await expect(publisher.publish(request)).rejects.toThrow(/no post id/);
  });
});
