import {
  PermanentPublishError,
  type Platform,
  type PublishRequest,
  type PublishResult,
  type Publisher,
} from '../types.js';

/**
 * Dispatches each post to the backend configured for its platform, so LinkedIn
 * and Facebook can go direct while other networks are added later (or routed
 * through an aggregator) without touching the scheduler.
 */
export class RoutingPublisher implements Publisher {
  readonly name = 'routing';

  constructor(private readonly routes: Partial<Record<Platform, Publisher>>) {}

  supports(platform: Platform): boolean {
    return this.routes[platform] !== undefined;
  }

  configured(): Platform[] {
    return Object.keys(this.routes) as Platform[];
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const publisher = this.routes[request.platform];
    if (publisher === undefined) {
      throw new PermanentPublishError(
        `no publisher configured for ${request.platform} - configure its credentials or remove it from the campaign`,
      );
    }
    return publisher.publish(request);
  }
}
