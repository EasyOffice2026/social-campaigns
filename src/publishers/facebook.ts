import {
  PermanentPublishError,
  TransientPublishError,
  type Platform,
  type PublishRequest,
  type PublishResult,
  type Publisher,
} from '../types.js';

export interface FacebookOptions {
  /** Page access token, not a user token. */
  pageAccessToken: string;
  pageId: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}

interface GraphResponse {
  id?: string;
  post_id?: string;
  error?: { message?: string; code?: number; type?: string; is_transient?: boolean };
}

/**
 * Posts to a Facebook Page with the Pages API. Needs a Page access token from a
 * user who can perform CREATE_CONTENT on the page, with `pages_manage_posts`
 * and `pages_read_engagement` granted to the app.
 */
export class FacebookPublisher implements Publisher {
  readonly name = 'facebook';
  private readonly fetchImpl: typeof fetch;
  private readonly graphVersion: string;

  constructor(private readonly options: FacebookOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.graphVersion = options.graphVersion ?? 'v21.0';
  }

  supports(platform: Platform): boolean {
    return platform === 'facebook';
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const [firstImage] = request.media;
    if (firstImage !== undefined && firstImage.kind !== 'image') {
      throw new PermanentPublishError('facebook video publishing is not implemented yet');
    }

    // Photos go to /photos with the image url; everything else to /feed.
    const endpoint = firstImage !== undefined ? 'photos' : 'feed';
    const params = new URLSearchParams({ access_token: this.options.pageAccessToken });
    if (firstImage !== undefined) {
      params.set('url', firstImage.url);
      params.set('caption', request.text);
    } else {
      params.set('message', request.text);
      if (request.link !== undefined) params.set('link', request.link);
    }

    const response = await this.fetchImpl(
      `https://graph.facebook.com/${this.graphVersion}/${this.options.pageId}/${endpoint}`,
      { method: 'POST', body: params },
    );

    const payload = (await response.json().catch(() => ({}))) as GraphResponse;

    if (!response.ok || payload.error !== undefined) {
      const detail = payload.error?.message ?? response.statusText;
      const transient =
        payload.error?.is_transient === true || response.status === 429 || response.status >= 500;
      const message = `facebook ${response.status}: ${detail}`;
      throw transient ? new TransientPublishError(message) : new PermanentPublishError(message);
    }

    const id = payload.post_id ?? payload.id;
    if (id === undefined) {
      throw new TransientPublishError('facebook returned no post id');
    }

    return {
      platformPostId: id,
      platformPostUrl: `https://www.facebook.com/${id}`,
    };
  }
}
