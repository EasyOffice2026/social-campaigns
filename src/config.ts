import 'dotenv/config';
import { z } from 'zod';
import { DryRunPublisher } from './publishers/dry-run.js';
import { AyrsharePublisher } from './publishers/ayrshare.js';
import { FacebookPublisher } from './publishers/facebook.js';
import { LinkedInPublisher } from './publishers/linkedin.js';
import { RoutingPublisher } from './publishers/routing.js';
import { MemoryPostStore } from './store/memory-store.js';
import { SupabasePostStore } from './store/supabase-store.js';
import type { PostStore } from './store/store.js';
import type { Platform, Publisher } from './types.js';

const envSchema = z.object({
  // LinkedIn Company Page (direct).
  LINKEDIN_ACCESS_TOKEN: z.string().min(1).optional(),
  LINKEDIN_ORGANIZATION_ID: z.string().min(1).optional(),
  LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/).default('202606'),

  // Facebook Page (direct).
  FACEBOOK_PAGE_ACCESS_TOKEN: z.string().min(1).optional(),
  FACEBOOK_PAGE_ID: z.string().min(1).optional(),
  FACEBOOK_GRAPH_VERSION: z.string().min(2).default('v21.0'),

  // Optional aggregator, used for any platform without direct credentials.
  AYRSHARE_API_KEY: z.string().min(1).optional(),
  AYRSHARE_PROFILE_KEY: z.string().min(1).optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  /** Master off switch: when false, nothing is ever sent to a live network. */
  PUBLISHING_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

/**
 * Live publishing requires both credentials and an explicit
 * `PUBLISHING_ENABLED=true`, so a stray cron run on a misconfigured box falls
 * back to dry-run instead of posting to real accounts.
 */
export function createPublisher(env: Env, forceDryRun = false): Publisher {
  if (forceDryRun || !env.PUBLISHING_ENABLED) {
    return new DryRunPublisher();
  }

  const routes = buildRoutes(env);
  if (Object.keys(routes).length === 0) {
    return new DryRunPublisher();
  }
  return new RoutingPublisher(routes);
}

export function buildRoutes(env: Env): Partial<Record<Platform, Publisher>> {
  const routes: Partial<Record<Platform, Publisher>> = {};

  if (env.LINKEDIN_ACCESS_TOKEN !== undefined && env.LINKEDIN_ORGANIZATION_ID !== undefined) {
    routes.linkedin = new LinkedInPublisher({
      accessToken: env.LINKEDIN_ACCESS_TOKEN,
      organizationId: env.LINKEDIN_ORGANIZATION_ID,
      apiVersion: env.LINKEDIN_API_VERSION,
    });
  }

  if (env.FACEBOOK_PAGE_ACCESS_TOKEN !== undefined && env.FACEBOOK_PAGE_ID !== undefined) {
    routes.facebook = new FacebookPublisher({
      pageAccessToken: env.FACEBOOK_PAGE_ACCESS_TOKEN,
      pageId: env.FACEBOOK_PAGE_ID,
      graphVersion: env.FACEBOOK_GRAPH_VERSION,
    });
  }

  // The aggregator covers whatever has no direct adapter configured yet.
  if (env.AYRSHARE_API_KEY !== undefined) {
    const ayrshare = new AyrsharePublisher({
      apiKey: env.AYRSHARE_API_KEY,
      ...(env.AYRSHARE_PROFILE_KEY !== undefined
        ? { profileKey: env.AYRSHARE_PROFILE_KEY }
        : {}),
    });
    for (const platform of ['linkedin', 'x', 'facebook', 'instagram'] as const) {
      routes[platform] ??= ayrshare;
    }
  }

  return routes;
}

export function createStore(env: Env): PostStore {
  if (env.SUPABASE_URL === undefined || env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
    return new MemoryPostStore();
  }
  return new SupabasePostStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export function isPersistent(env: Env): boolean {
  return env.SUPABASE_URL !== undefined && env.SUPABASE_SERVICE_ROLE_KEY !== undefined;
}
