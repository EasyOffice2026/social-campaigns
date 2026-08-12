# social-campaigns

Automated social media marketing campaigns for LinkedIn, X, Facebook and
Instagram: define a campaign as a file, review the generated posts, approve them,
and a worker publishes each one at its slot.

Nothing reaches a live account without (a) an explicit approval on the post and
(b) `PUBLISHING_ENABLED=true` in the environment. Without both, every command
runs in dry-run mode.

## Quick start

```bash
npm install
cp .env.example .env

# See exactly what would be posted - no store, no network, no credentials needed.
npm run campaigns -- preview campaigns/example.campaign.json
```

With Supabase configured (`database/schema.sql` applied):

```bash
npm run campaigns -- plan campaigns/example.campaign.json
npm run campaigns -- list campaigns/example.campaign.json
npm run campaigns -- approve campaigns/example.campaign.json --all --by javed
npm run campaigns -- run --dry-run     # rehearse
npm run worker                          # long-running publisher
```

## How a campaign works

A campaign file declares the platforms, the languages, a cadence and the content
pieces. `plan` expands it into one post per **content x language x platform**,
lays those onto the cadence slots in the campaign's timezone, and stores them as
`pending_approval`.

```
draft -> pending_approval -> scheduled -> publishing -> published
                                  \-> failed
```

Post ids are derived from the campaign (`<campaign>:<contentKey>:<lang>:<platform>`),
so re-running `plan` after an edit updates the existing post instead of creating
a duplicate. Editing the copy of an already-approved post sends it back to
`pending_approval`; already-published posts are never rewritten.

Per-platform rendering is enforced up front rather than at publish time: X copy
over 280 characters or an Instagram post with no media is reported by `plan` and
`preview` as a problem, and the campaign writes nothing until it is fixed.

## Publishing backend

Posting goes through [Ayrshare](https://www.ayrshare.com), behind the `Publisher`
interface in `src/types.ts`. This avoids blocking on LinkedIn's Community
Management API access request and Meta's App Review, which are external
approvals with multi-week turnarounds. Swapping in direct platform adapters later
means adding a file next to `src/publishers/ayrshare.ts` — nothing else changes.

Platform constraints worth remembering:

| Platform | Constraint |
| --- | --- |
| LinkedIn | Page posting needs Community Management API access + a page admin |
| X | No free tier since Feb 2026: ~$0.015/post, ~$0.20 if the post has a link |
| Facebook | `pages_manage_posts` + a Page access token; supports native scheduling |
| Instagram | Business account only, media must be a public HTTPS URL, 50 posts/24h |

## Safety properties

- **Approval gate** — a post publishes only after `approve` records who approved it.
- **Kill switch** — `PUBLISHING_ENABLED=false` degrades to dry-run everywhere.
- **At-most-once** — a post is claimed with a compare-and-set on
  `(status, attempts)`, and a unique index on `(platform, platform_post_id)`
  blocks a duplicate publish at the database level.
- **Crash recovery** — the queue lives in Postgres; posts stuck in `publishing`
  by a dead worker are requeued after 15 minutes.
- **Rate ceilings** — Instagram's hard 50/24h limit plus conservative
  self-imposed caps per platform (`src/scheduler/rate-limits.ts`), including one
  on X that doubles as a spend cap.
- **Retries** — transient provider errors retry up to 3 attempts; a rejected
  request (bad caption, bad media) fails immediately instead of hammering the API.

## Layout

```
src/campaign.ts            campaign file schema (zod)
src/planner.ts             campaign -> posts, slot assignment, stable ids
src/content/render.ts      per-platform text/hashtag/media rules
src/publishers/            Ayrshare + dry-run backends
src/scheduler/             tick loop, rate limits, worker entrypoint
src/store/                 Postgres (Supabase) and in-memory queues
database/schema.sql        mkt_posts table, indexes, trigger
```

## Commands

```bash
npm run lint
npm run typecheck
npm test
```
