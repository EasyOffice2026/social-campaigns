import { describe, expect, it } from 'vitest';
import { LinkedInPublisher } from '../src/publishers/linkedin.js';
import { PermanentPublishError, TransientPublishError, type PublishRequest } from '../src/types.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

interface StubResponse {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  body?: ArrayBuffer;
}

function stub(responses: StubResponse[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses[calls.length - 1] ?? {};
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      headers: new Headers(next.headers ?? {}),
      json: async () => next.json ?? {},
      text: async () => next.text ?? '',
      arrayBuffer: async () => next.body ?? new ArrayBuffer(4),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function publisher(fetchImpl: typeof fetch): LinkedInPublisher {
  return new LinkedInPublisher({
    accessToken: 'token-1',
    organizationId: '5583111',
    apiVersion: '202606',
    fetchImpl,
  });
}

const textPost: PublishRequest = {
  platform: 'linkedin',
  text: 'Approve keeps contracts in one place.',
  media: [],
  link: 'https://example.com/approve',
  idempotencyKey: 'demo:one:en:linkedin',
};

describe('LinkedInPublisher', () => {
  it('posts as the organization and returns the urn from the response header', async () => {
    const { fetchImpl, calls } = stub([
      { headers: { 'x-restli-id': 'urn:li:share:7100' } },
    ]);

    const result = await publisher(fetchImpl).publish(textPost);

    expect(result.platformPostId).toBe('urn:li:share:7100');
    expect(result.platformPostUrl).toContain('urn:li:share:7100');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.author).toBe('urn:li:organization:5583111');
    expect(body.lifecycleState).toBe('PUBLISHED');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['LinkedIn-Version']).toBe('202606');
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0');
  });

  it('sends a bare link as an article so LinkedIn renders the preview card', async () => {
    const { fetchImpl, calls } = stub([{ headers: { 'x-restli-id': 'urn:li:share:1' } }]);

    await publisher(fetchImpl).publish(textPost);

    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.content).toEqual({ article: { source: 'https://example.com/approve' } });
  });

  it('uploads an image before creating the post and references its urn', async () => {
    const { fetchImpl, calls } = stub([
      { json: { value: { uploadUrl: 'https://upload.linkedin.com/x', image: 'urn:li:image:9' } } },
      { body: new ArrayBuffer(8) },
      {},
      { headers: { 'x-restli-id': 'urn:li:share:2' } },
    ]);

    await publisher(fetchImpl).publish({
      ...textPost,
      media: [{ url: 'https://cdn.example.com/a.png', kind: 'image' }],
    });

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.linkedin.com/rest/images?action=initializeUpload',
      'https://cdn.example.com/a.png',
      'https://upload.linkedin.com/x',
      'https://api.linkedin.com/rest/posts',
    ]);
    expect(calls[2]?.init?.method).toBe('PUT');
    const body = JSON.parse(String(calls[3]?.init?.body));
    expect(body.content).toEqual({ media: { id: 'urn:li:image:9' } });
  });

  it('explains a 401 as an expired token or missing page rights', async () => {
    const { fetchImpl } = stub([{ status: 401, text: 'invalid token' }]);

    await expect(publisher(fetchImpl).publish(textPost)).rejects.toThrow(
      /admin of organization 5583111/,
    );
  });

  it('retries a 429 and gives up on a 422', async () => {
    const throttled = stub([{ status: 429, text: 'slow down' }]);
    await expect(publisher(throttled.fetchImpl).publish(textPost)).rejects.toBeInstanceOf(
      TransientPublishError,
    );

    const rejected = stub([{ status: 422, text: 'bad commentary' }]);
    await expect(publisher(rejected.fetchImpl).publish(textPost)).rejects.toBeInstanceOf(
      PermanentPublishError,
    );
  });

  it('fails rather than reporting success when no urn comes back', async () => {
    const { fetchImpl } = stub([{}]);
    await expect(publisher(fetchImpl).publish(textPost)).rejects.toThrow(/no post urn/);
  });
});
