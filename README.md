# social-campaigns

Automated social media marketing campaigns for LinkedIn, X, Facebook and
Instagram: define a campaign as a file, review the generated posts, approve them,
and a worker publishes each one at its slot.

Nothing reaches a live account without (a) an explicit approval on the post and
(b) `PUBLISHING_ENABLED=true` in the environment. Without both, every command
runs in dry-run mode.

LinkedIn and Facebook publish through their own APIs directly (no third-party
fee); X and Instagram are not wired up yet.

## Quick start

```bash
npm install
cp .env.example .env

# See exactly what would be posted - no store, no network, no credentials needed.
npm run campaigns -- preview campaigns/example.campaign.json
```

No database needed for these either:

```bash
npm run campaigns -- check              # are the platform credentials alive?
npm run campaigns -- generate campaigns/example.brief.json --out campaigns/q3.campaign.json
```

With Supabase configured (`database/schema.sql` applied):

```bash
npm run campaigns -- plan campaigns/example.campaign.json
npm run campaigns -- list campaigns/example.campaign.json
npm run campaigns -- approve campaigns/example.campaign.json --all --by javed
npm run campaigns -- run --dry-run      # rehearse
npm run worker                          # long-running publisher
```

## Writing the content

You can write the campaign file by hand, or draft it from a brief:

```bash
npm run campaigns -- generate campaigns/example.brief.json --out campaigns/q3.campaign.json
```

A brief (`campaigns/example.brief.json`) states the product, audience, tone, the
benefits the copy may draw on, the call to action, and what to avoid. The model
writes one piece of content per post in every requested language, with a shorter
`overrides.x` variant where the long version cannot fit.

The draft is then validated exactly as `plan` would validate it, and any platform
violation is fed back to the model to repair (up to 3 round trips) — so the file
you get is already publishable rather than a draft that fails later. Generation
never publishes: it writes a campaign file for you to read, and every post still
goes through the approval gate.

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to enable it. Arabic is written
natively rather than translated from the English.

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

## Publishing backends

Each platform is routed to a backend by `buildRoutes`, so they can be adopted one
at a time:

| Platform | Backend | Status |
| --- | --- | --- |
| LinkedIn | direct — `POST /rest/posts` as the Company Page | needs Community Management API access + a page admin token |
| Facebook | direct — Pages API `/{page-id}/feed` and `/photos` | needs a Page access token with `pages_manage_posts` |
| X | none yet | no free tier since Feb 2026: ~$0.015/post, ~$0.20 with a link |
| Instagram | none yet | Business account, public HTTPS media only, 50 posts/24h |

Setup steps for the tokens are in [docs/CREDENTIALS.md](docs/CREDENTIALS.md).
A campaign targeting a platform with no configured backend fails loudly rather
than skipping the post. If `AYRSHARE_API_KEY` is set, Ayrshare covers whatever
has no direct adapter — useful for adding X or Instagram without writing one.

LinkedIn posts a bare link as an `article` and Facebook as a `link` post, so both
render their own preview card and the URL is left out of the copy; X keeps it
inline. Images are uploaded as binary to LinkedIn (two-step `initializeUpload`)
but passed to Facebook by URL.

## Safety properties

- **Approval gate** — a post publishes only after `approve` records who approved it.
- **Credential check** — `check` verifies each token against a read endpoint;
  LinkedIn and Facebook page tokens expire about every 60 days.
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
src/generate/            brief schema, prompt, validate-and-repair loop, LLM clients
src/accounts.ts            credential checks behind `campaigns check`
src/publishers/            linkedin, facebook, ayrshare, dry-run, routing
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
