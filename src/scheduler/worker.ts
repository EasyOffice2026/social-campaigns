import { createPublisher, createStore, isPersistent, loadEnv } from '../config.js';
import { Scheduler } from './scheduler.js';

/**
 * Long-running worker: ticks the queue on an interval. The queue itself lives in
 * Postgres, so a restart resumes exactly where it left off.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!isPersistent(env)) {
    throw new Error('the worker needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  const scheduler = new Scheduler({ store: createStore(env), publisher: createPublisher(env) });
  const intervalMs = env.WORKER_INTERVAL_SECONDS * 1000;
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`[worker] ${signal} received, finishing current tick`);
      stopping = true;
    });
  }

  console.log(
    `[worker] started (publishing ${env.PUBLISHING_ENABLED ? 'ENABLED' : 'disabled - dry run'}, every ${env.WORKER_INTERVAL_SECONDS}s)`,
  );

  while (!stopping) {
    try {
      await scheduler.tick();
    } catch (error) {
      console.error('[worker] tick failed:', error instanceof Error ? error.message : error);
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.log('[worker] stopped');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
