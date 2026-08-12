import { describe, expect, it } from 'vitest';
import { buildRoutes, createPublisher, loadEnv } from '../src/config.js';
import { RoutingPublisher } from '../src/publishers/routing.js';
import { PermanentPublishError, type PublishRequest, type Publisher } from '../src/types.js';

const baseEnv = {
  LINKEDIN_ACCESS_TOKEN: 'li-token',
  LINKEDIN_ORGANIZATION_ID: '5583111',
  FACEBOOK_PAGE_ACCESS_TOKEN: 'fb-token',
  FACEBOOK_PAGE_ID: '123',
  PUBLISHING_ENABLED: 'true' as const,
};

const request: PublishRequest = {
  platform: 'x',
  text: 'hello',
  media: [],
  idempotencyKey: 'demo:one:en:x',
};

describe('publisher wiring', () => {
  it('routes LinkedIn and Facebook to their direct adapters', () => {
    const routes = buildRoutes(loadEnv(baseEnv));

    expect(routes.linkedin?.name).toBe('linkedin');
    expect(routes.facebook?.name).toBe('facebook');
    expect(routes.x).toBeUndefined();
    expect(routes.instagram).toBeUndefined();
  });

  it('fills the platforms without a direct adapter from Ayrshare when a key exists', () => {
    const routes = buildRoutes(loadEnv({ ...baseEnv, AYRSHARE_API_KEY: 'key' }));

    expect(routes.linkedin?.name).toBe('linkedin');
    expect(routes.x?.name).toBe('ayrshare');
    expect(routes.instagram?.name).toBe('ayrshare');
  });

  it('stays in dry-run unless publishing is explicitly enabled', () => {
    expect(createPublisher(loadEnv({ ...baseEnv, PUBLISHING_ENABLED: 'false' })).name).toBe(
      'dry-run',
    );
    expect(createPublisher(loadEnv(baseEnv)).name).toBe('routing');
    expect(createPublisher(loadEnv(baseEnv), true).name).toBe('dry-run');
  });

  it('falls back to dry-run when publishing is on but nothing is configured', () => {
    expect(createPublisher(loadEnv({ PUBLISHING_ENABLED: 'true' })).name).toBe('dry-run');
  });

  it('fails a post for an unconfigured platform instead of silently dropping it', async () => {
    const routing = new RoutingPublisher({});

    await expect(routing.publish(request)).rejects.toBeInstanceOf(PermanentPublishError);
    await expect(routing.publish(request)).rejects.toThrow(/no publisher configured for x/);
  });

  it('dispatches to the publisher registered for the platform', async () => {
    const seen: string[] = [];
    const fake: Publisher = {
      name: 'fake',
      supports: () => true,
      publish: async (item) => {
        seen.push(item.platform);
        return { platformPostId: 'p1' };
      },
    };

    const result = await new RoutingPublisher({ x: fake }).publish(request);

    expect(result.platformPostId).toBe('p1');
    expect(seen).toEqual(['x']);
  });
});
