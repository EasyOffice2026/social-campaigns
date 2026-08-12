-- Social campaign automation. Tables are prefixed `mkt_` so this project can
-- share a Supabase instance with the other products without colliding.

create table if not exists mkt_posts (
  id                text primary key,
  campaign_id       text not null,
  platform          text not null check (platform in ('linkedin', 'x', 'facebook', 'instagram')),
  language          text not null check (language in ('en', 'ar')),
  body              text not null,
  hashtags          jsonb not null default '[]'::jsonb,
  media             jsonb not null default '[]'::jsonb,
  link              text,
  scheduled_at      timestamptz not null,
  status            text not null default 'pending_approval'
                      check (status in ('draft', 'pending_approval', 'scheduled',
                                        'publishing', 'published', 'failed', 'cancelled')),
  attempts          integer not null default 0,
  platform_post_id  text,
  platform_post_url text,
  last_error        text,
  claimed_at        timestamptz,
  approved_by       text,
  approved_at       timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The worker's hot query: approved posts whose slot has arrived.
create index if not exists mkt_posts_due_idx
  on mkt_posts (status, scheduled_at);

create index if not exists mkt_posts_campaign_idx
  on mkt_posts (campaign_id, scheduled_at);

-- Rate-limit accounting per platform over a rolling window.
create index if not exists mkt_posts_published_idx
  on mkt_posts (platform, published_at)
  where status = 'published';

-- A platform post id may only ever appear once, so a duplicate publish of the
-- same slot is rejected by the database and not just by application logic.
create unique index if not exists mkt_posts_platform_post_id_idx
  on mkt_posts (platform, platform_post_id)
  where platform_post_id is not null;

create or replace function mkt_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists mkt_posts_touch_updated_at on mkt_posts;
create trigger mkt_posts_touch_updated_at
  before update on mkt_posts
  for each row execute function mkt_touch_updated_at();

-- The worker connects with the service role key; no anon access to the queue.
alter table mkt_posts enable row level security;
