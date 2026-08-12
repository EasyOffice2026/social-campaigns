import type { PublishRequest, PublishResult, Publisher } from '../types.js';

/**
 * Records what would have been published without calling any network. Used by
 * `campaigns run --dry-run`, which is how a campaign is validated end to end
 * before any real account (or X's per-post charge) is involved.
 */
export class DryRunPublisher implements Publisher {
  readonly name = 'dry-run';
  readonly sent: PublishRequest[] = [];

  constructor(private readonly log: (line: string) => void = console.log) {}

  supports(): boolean {
    return true;
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    this.sent.push(request);
    this.log(
      [
        `--- [dry-run] ${request.platform} (${request.text.length} chars)`,
        request.text,
        request.media.length > 0
          ? `media: ${request.media.map((asset) => asset.url).join(', ')}`
          : 'media: none',
      ].join('\n'),
    );
    return { platformPostId: `dry-run-${request.idempotencyKey}` };
  }
}
