import {
  PermanentPublishError,
  TransientPublishError,
  type Platform,
  type PublishRequest,
  type PublishResult,
  type Publisher,
} from '../types.js';

const API_URL = 'https://api.ayrshare.com/api/post';

/** Ayrshare's platform keys differ slightly from ours. */
const PLATFORM_KEYS: Record<Platform, string> = {
  linkedin: 'linkedin',
  x: 'twitter',
  facebook: 'facebook',
  instagram: 'instagram',
};

export interface AyrshareOptions {
  apiKey: string;
  /** Ayrshare Business-plan profile key, when posting for a specific brand. */
  profileKey?: string;
  fetchImpl?: typeof fetch;
}

interface AyrshareResponse {
  status?: string;
  errors?: { message?: string; action?: string }[];
  postIds?: { platform?: string; id?: string; postUrl?: string }[];
  message?: string;
}

/**
 * Publishes through Ayrshare, which fans a single call out to the connected
 * networks. Chosen over direct platform APIs because LinkedIn's Community
 * Management access and Meta's App Review are external approvals we cannot
 * shorten; swapping this for direct adapters later only touches this file.
 */
export class AyrsharePublisher implements Publisher {
  readonly name = 'ayrshare';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AyrshareOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  supports(): boolean {
    return true;
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': request.idempotencyKey,
    };
    if (this.options.profileKey !== undefined) {
      headers['Profile-Key'] = this.options.profileKey;
    }

    const response = await this.fetchImpl(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        post: request.text,
        platforms: [PLATFORM_KEYS[request.platform]],
        mediaUrls: request.media.map((asset) => asset.url),
        idempotencyKey: request.idempotencyKey,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as AyrshareResponse;

    if (!response.ok) {
      const detail = payload.errors?.[0]?.message ?? payload.message ?? response.statusText;
      if (response.status === 429 || response.status >= 500) {
        throw new TransientPublishError(`ayrshare ${response.status}: ${detail}`);
      }
      throw new PermanentPublishError(`ayrshare ${response.status}: ${detail}`);
    }

    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new PermanentPublishError(
        `ayrshare rejected the post: ${payload.errors[0]?.message ?? 'unknown error'}`,
      );
    }

    const entry = payload.postIds?.find(
      (item) => item.platform === PLATFORM_KEYS[request.platform],
    );
    if (entry?.id === undefined) {
      throw new TransientPublishError('ayrshare returned no post id');
    }

    return {
      platformPostId: entry.id,
      ...(entry.postUrl !== undefined ? { platformPostUrl: entry.postUrl } : {}),
    };
  }
}
