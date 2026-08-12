import 'dotenv/config';
import { z } from 'zod';
import { DryRunPublisher } from './publishers/dry-run.js';
import { AyrsharePublisher } from './publishers/ayrshare.js';
import { MemoryPostStore } from './store/memory-store.js';
import { SupabasePostStore } from './store/supabase-store.js';
import type { PostStore } from './store/store.js';
import type { Publisher } from './types.js';

const envSchema = z.object({
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
 * Live publishing requires both a credential and an explicit
 * `PUBLISHING_ENABLED=true`, so a stray cron run on a misconfigured box falls
 * back to dry-run instead of posting to real accounts.
 */
export function createPublisher(env: Env, forceDryRun = false): Publisher {
  if (forceDryRun || !env.PUBLISHING_ENABLED || env.AYRSHARE_API_KEY === undefined) {
    return new DryRunPublisher();
  }
  return new AyrsharePublisher({
    apiKey: env.AYRSHARE_API_KEY,
    ...(env.AYRSHARE_PROFILE_KEY !== undefined
      ? { profileKey: env.AYRSHARE_PROFILE_KEY }
      : {}),
  });
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
