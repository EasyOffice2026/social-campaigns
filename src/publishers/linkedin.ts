import {
  PermanentPublishError,
  TransientPublishError,
  type MediaAsset,
  type Platform,
  type PublishRequest,
  type PublishResult,
  type Publisher,
} from '../types.js';

const API_BASE = 'https://api.linkedin.com';

export interface LinkedInOptions {
  accessToken: string;
  /** Numeric id of the Company Page, i.e. the 5583111 in urn:li:organization:5583111. */
  organizationId: string;
  /** Versioned API date in YYYYMM form; LinkedIn rejects requests without it. */
  apiVersion: string;
  fetchImpl?: typeof fetch;
}

interface InitializeUploadResponse {
  value?: { uploadUrl?: string; image?: string };
}

/**
 * Posts to a LinkedIn Company Page via the versioned Posts API.
 *
 * Requires the `w_organization_social` scope, which only comes with approved
 * Community Management API access, and a token whose member is an
 * ADMINISTRATOR or CONTENT_ADMIN of the page.
 */
export class LinkedInPublisher implements Publisher {
  readonly name = 'linkedin';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LinkedInOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  supports(platform: Platform): boolean {
    return platform === 'linkedin';
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const author = `urn:li:organization:${this.options.organizationId}`;

    const body: Record<string, unknown> = {
      author,
      commentary: request.text,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    const [firstImage] = request.media;
    if (firstImage !== undefined) {
      // Images must be uploaded as binary first; the post then references the urn.
      body.content = { media: { id: await this.uploadImage(firstImage, author) } };
    } else if (request.link !== undefined) {
      // Without media, a link becomes an article card rather than a bare URL.
      body.content = { article: { source: request.link } };
    }

    const response = await this.fetchImpl(`${API_BASE}/rest/posts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.errorFor(response, 'creating the post');
    }

    // The Posts API returns the urn in a header rather than a body.
    const urn = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id');
    if (urn === null) {
      throw new TransientPublishError('linkedin returned no post urn');
    }

    return {
      platformPostId: urn,
      platformPostUrl: `https://www.linkedin.com/feed/update/${urn}/`,
    };
  }

  /** Fetches the asset from its public URL, then streams it to LinkedIn. */
  private async uploadImage(asset: MediaAsset, owner: string): Promise<string> {
    if (asset.kind !== 'image') {
      throw new PermanentPublishError('linkedin video upload is not implemented yet');
    }

    const init = await this.fetchImpl(`${API_BASE}/rest/images?action=initializeUpload`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    if (!init.ok) throw await this.errorFor(init, 'initializing the image upload');

    const { value } = (await init.json()) as InitializeUploadResponse;
    if (value?.uploadUrl === undefined || value.image === undefined) {
      throw new TransientPublishError('linkedin did not return an upload url');
    }

    const source = await this.fetchImpl(asset.url);
    if (!source.ok) {
      throw new PermanentPublishError(`could not download media ${asset.url}: ${source.status}`);
    }

    const upload = await this.fetchImpl(value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.options.accessToken}` },
      body: Buffer.from(await source.arrayBuffer()),
    });
    if (!upload.ok) throw await this.errorFor(upload, 'uploading the image');

    return value.image;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': this.options.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  private async errorFor(response: Response, action: string): Promise<Error> {
    const detail = await response.text().catch(() => '');
    const message = `linkedin ${response.status} while ${action}: ${detail.slice(0, 400)}`;
    if (response.status === 429 || response.status >= 500) {
      return new TransientPublishError(message);
    }
    if (response.status === 401 || response.status === 403) {
      return new PermanentPublishError(
        `${message} - check the token is valid and the member is an admin of organization ${this.options.organizationId}`,
      );
    }
    return new PermanentPublishError(message);
  }
}
