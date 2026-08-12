import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../src/scheduler/scheduler.js';
import { RATE_LIMITS } from '../src/scheduler/rate-limits.js';
import { MemoryPostStore } from '../src/store/memory-store.js';
import {
  PermanentPublishError,
  TransientPublishError,
  type Post,
  type PublishRequest,
  type PublishResult,
  type Publisher,
} from '../src/types.js';

const NOW = new Date('2026-09-01T12:00:00.000Z');

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'demo:one:en:linkedin',
    campaignId: 'demo',
    platform: 'linkedin',
    language: 'en',
    body: 'hello',
    hashtags: [],
    media: [],
    scheduledAt: '2026-09-01T11:00:00.000Z',
    status: 'scheduled',
    attempts: 0,
    ...overrides,
  };
}

class StubPublisher implements Publisher {
  readonly name = 'stub';
  readonly sent: PublishRequest[] = [];

  constructor(private readonly behaviour: (call: number) => PublishResult | Error = () => ({
    platformPostId: 'p1',
  })) {}

  supports(): boolean {
    return true;
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    this.sent.push(request);
    const outcome = this.behaviour(this.sent.length);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

async function seed(store: MemoryPostStore, ...posts: Post[]): Promise<void> {
  await store.upsertPlanned(posts.map((item) => ({ ...item, status: 'pending_approval' })));
  await store.approve(
    posts.map((item) => item.id),
    'tester',
  );
}

function scheduler(store: MemoryPostStore, publisher: Publisher, maxAttempts = 3): Scheduler {
  return new Scheduler({
    store,
    publisher,
    maxAttempts,
    log: () => {},
    now: () => NOW,
  });
}

describe('Scheduler', () => {
  it('publishes approved posts whose slot has arrived', async () => {
    const store = new MemoryPostStore();
    await seed(store, post());
    const publisher = new StubPublisher();

    const result = await scheduler(store, publisher).tick();

    expect(result.published).toEqual(['demo:one:en:linkedin']);
    expect(publisher.sent[0]?.idempotencyKey).toBe('demo:one:en:linkedin');
    const [stored] = await store.listByCampaign('demo');
    expect(stored?.status).toBe('published');
    expect(stored?.platformPostId).toBe('p1');
  });

  it('never publishes a post that was not approved', async () => {
    const store = new MemoryPostStore();
    await store.upsertPlanned([post({ status: 'pending_approval' })]);
    const publisher = new StubPublisher();

    const result = await scheduler(store, publisher).tick();

    expect(publisher.sent).toEqual([]);
    expect(result.published).toEqual([]);
  });

  it('leaves future slots alone', async () => {
    const store = new MemoryPostStore();
    await seed(store, post({ scheduledAt: '2026-09-02T09:00:00.000Z' }));
    const publisher = new StubPublisher();

    await scheduler(store, publisher).tick();

    expect(publisher.sent).toEqual([]);
  });

  it('retries a transient failure and stops at maxAttempts', async () => {
    const store = new MemoryPostStore();
    await seed(store, post());
    const publisher = new StubPublisher(() => new TransientPublishError('502 from provider'));
    const worker = scheduler(store, publisher, 2);

    const first = await worker.tick();
    expect(first.retrying).toEqual(['demo:one:en:linkedin']);

    const second = await worker.tick();
    expect(second.failed).toEqual(['demo:one:en:linkedin']);
    expect(publisher.sent).toHaveLength(2);

    const third = await worker.tick();
    expect(third.published).toEqual([]);
    expect(publisher.sent).toHaveLength(2);
  });

  it('does not retry a permanent failure', async () => {
    const store = new MemoryPostStore();
    await seed(store, post());
    const publisher = new StubPublisher(() => new PermanentPublishError('caption too long'));

    const result = await scheduler(store, publisher).tick();

    expect(result.failed).toEqual(['demo:one:en:linkedin']);
    const [stored] = await store.listByCampaign('demo');
    expect(stored?.status).toBe('failed');
  });

  it('reconciles instead of re-sending when a platform post id is already stored', async () => {
    const store = new MemoryPostStore();
    await seed(store, post());
    await store.markFailed('demo:one:en:linkedin', 'status write lost', true);
    const publisher = new StubPublisher();
    const stored = (await store.listByCampaign('demo'))[0];
    await store.upsertPlanned([{ ...stored!, platformPostId: 'already-live' }]);
    await store.approve(['demo:one:en:linkedin'], 'tester');

    const result = await scheduler(store, publisher).tick();

    expect(publisher.sent).toEqual([]);
    expect(result.published).toEqual(['demo:one:en:linkedin']);
  });

  it('defers a post that would breach the platform rate limit', async () => {
    const store = new MemoryPostStore();
    const limit = RATE_LIMITS.linkedin.max;
    const published: Post[] = Array.from({ length: limit }, (_, index) =>
      post({ id: `demo:filler${index}:en:linkedin` }),
    );
    await seed(store, ...published, post());
    for (const filler of published) {
      await store.claim({ ...filler, attempts: 0 });
      await store.markPublished(filler.id, { platformPostId: filler.id }, NOW);
    }
    const publisher = new StubPublisher();

    const result = await scheduler(store, publisher).tick();

    expect(publisher.sent).toEqual([]);
    expect(result.deferred[0]?.reason).toMatch(/rate limit reached/);
  });

  it('requeues a post abandoned by a crashed worker', async () => {
    const store = new MemoryPostStore();
    await seed(store, post());
    await store.claim(post());
    const publisher = new StubPublisher();

    const worker = new Scheduler({
      store,
      publisher,
      log: () => {},
      staleClaimMs: 0,
      now: () => new Date(NOW.getTime() + 60_000),
    });
    const result = await worker.tick();

    expect(result.requeued).toBe(1);
    expect(result.published).toEqual(['demo:one:en:linkedin']);
  });

  it('lets only one of two concurrent workers publish a slot', async () => {
    const store = new MemoryPostStore();
    await seed(store, post());
    const publisher = new StubPublisher();
    const claim = vi.spyOn(store, 'claim');

    const [a, b] = await Promise.all([
      scheduler(store, publisher).tick(),
      scheduler(store, publisher).tick(),
    ]);

    expect(claim).toHaveBeenCalledTimes(2);
    expect(publisher.sent).toHaveLength(1);
    expect([...a.published, ...b.published]).toEqual(['demo:one:en:linkedin']);
  });
});
