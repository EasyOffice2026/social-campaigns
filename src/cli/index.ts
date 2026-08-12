import { readFile } from 'node:fs/promises';
import { parseCampaign } from '../campaign.js';
import { createPublisher, createStore, isPersistent, loadEnv } from '../config.js';
import { planCampaign } from '../planner.js';
import { Scheduler } from '../scheduler/scheduler.js';
import type { PostStore } from '../store/store.js';

const USAGE = `campaigns <command>

  preview <campaign.json>           render every post and print it, touching no store or network
  plan <campaign.json>              validate a campaign and write its posts as pending_approval
  list <campaign.json>              show every post of a campaign with its status
  approve <campaign.json> [--all|--id <postId>...] --by <name>
  run [--dry-run]                   publish approved posts whose slot has arrived (one pass)

Live publishing additionally requires PUBLISHING_ENABLED=true and an Ayrshare key.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const env = loadEnv();
  const store = createStore(env);

  if (
    !isPersistent(env) &&
    command !== undefined &&
    command !== 'help' &&
    command !== 'preview'
  ) {
    console.warn(
      '[warn] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - using an in-memory store, nothing persists between commands',
    );
  }

  switch (command) {
    case 'preview':
      return preview(rest);
    case 'plan':
      return plan(rest, store);
    case 'list':
      return list(rest, store);
    case 'approve':
      return approve(rest, store);
    case 'run':
      return run(rest, store, env);
    default:
      console.log(USAGE);
      return command === undefined || command === 'help' ? 0 : 1;
  }
}

async function loadCampaignFile(path: string | undefined) {
  if (path === undefined) throw new Error('a campaign file path is required');
  return parseCampaign(JSON.parse(await readFile(path, 'utf8')));
}

async function preview(args: string[]): Promise<number> {
  const campaign = await loadCampaignFile(args[0]);
  const { posts, problems } = planCampaign(campaign);

  for (const post of posts) {
    console.log(
      `\n=== ${post.scheduledAt}  ${post.platform} / ${post.language}  (${post.body.length} chars)`,
    );
    console.log(post.body);
    if (post.media.length > 0) {
      console.log(`media: ${post.media.map((asset) => asset.url).join(', ')}`);
    }
    for (const warning of post.warnings) console.warn(`[warn] ${warning}`);
  }

  for (const problem of problems) {
    console.error(
      `\n[error] ${problem.contentKey} / ${problem.platform} / ${problem.language}: ${problem.problems.join('; ')}`,
    );
  }

  console.log(
    `\n${posts.length} post(s) would be created, ${problems.length} problem(s) to fix`,
  );
  return problems.length > 0 ? 1 : 0;
}

async function plan(args: string[], store: PostStore): Promise<number> {
  const campaign = await loadCampaignFile(args[0]);
  const { posts, problems } = planCampaign(campaign);

  for (const problem of problems) {
    console.error(
      `[error] ${problem.contentKey} / ${problem.platform} / ${problem.language}: ${problem.problems.join('; ')}`,
    );
  }
  for (const post of posts) {
    for (const warning of post.warnings) {
      console.warn(`[warn] ${post.id}: ${warning}`);
    }
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) - fix the campaign, nothing was written`);
    return 1;
  }

  const outcome = await store.upsertPlanned(posts);
  console.log(
    `planned ${posts.length} post(s) for "${campaign.name}": ${outcome.created.length} new, ${outcome.updated.length} updated, ${outcome.unchangedPublished.length} already published`,
  );
  console.log('all new posts are pending_approval - approve them before they can publish');
  return 0;
}

async function list(args: string[], store: PostStore): Promise<number> {
  const campaign = await loadCampaignFile(args[0]);
  const posts = await store.listByCampaign(campaign.id);
  if (posts.length === 0) {
    console.log('no posts stored yet - run `plan` first');
    return 0;
  }
  for (const post of posts) {
    const detail = post.platformPostUrl ?? post.lastError ?? '';
    console.log(
      `${post.scheduledAt}  ${post.status.padEnd(16)} ${post.platform.padEnd(10)} ${post.language}  ${post.id}  ${detail}`,
    );
  }
  return 0;
}

async function approve(args: string[], store: PostStore): Promise<number> {
  const campaign = await loadCampaignFile(args[0]);
  const approver = valueOf(args, '--by');
  if (approver === undefined) {
    console.error('--by <name> is required so the approval is attributable');
    return 1;
  }

  const explicit = allValuesOf(args, '--id');
  let ids = explicit;
  if (args.includes('--all')) {
    const posts = await store.listByCampaign(campaign.id);
    ids = posts.filter((post) => post.status === 'pending_approval').map((post) => post.id);
  }
  if (ids.length === 0) {
    console.error('nothing to approve - pass --all or --id <postId>');
    return 1;
  }

  const approved = await store.approve(ids, approver);
  console.log(`approved ${approved.length} of ${ids.length} post(s) as ${approver}`);
  return 0;
}

async function run(args: string[], store: PostStore, env: ReturnType<typeof loadEnv>): Promise<number> {
  const dryRun = args.includes('--dry-run');
  const publisher = createPublisher(env, dryRun);
  if (publisher.name === 'dry-run' && !dryRun) {
    console.warn('[warn] publishing is disabled or unconfigured - running in dry-run mode');
  }

  const scheduler = new Scheduler({ store, publisher });
  const result = await scheduler.tick();
  console.log(
    `published ${result.published.length}, retrying ${result.retrying.length}, failed ${result.failed.length}, deferred ${result.deferred.length}, requeued ${result.requeued}`,
  );
  return result.failed.length > 0 ? 1 : 0;
}

function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function allValuesOf(args: string[], flag: string): string[] {
  const values: string[] = [];
  args.forEach((arg, index) => {
    if (arg !== flag) return;
    const value = args[index + 1];
    if (value !== undefined) values.push(value);
  });
  return values;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
