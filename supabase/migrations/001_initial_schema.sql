-- ============================================================
-- clutchgg — Initial Supabase Schema
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- ─── PROFILES ────────────────────────────────────────────────
-- Extends auth.users with role info
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'admin' check (role in ('admin', 'superadmin')),
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

create policy "Admins can read all profiles"
  on profiles for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('admin','superadmin')
    )
  );

-- ─── TOURNAMENTS ─────────────────────────────────────────────
create table if not exists tournaments (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  overview                    text,
  tournament_type             text not null default 'single' check (tournament_type in ('single','group')),
  status                      text not null default 'planning' check (status in ('planning','registration','in-progress','completed')),
  event_type                  text check (event_type in ('online','offline','hybrid')),
  event_location              text,
  event_start_date            date,
  event_max_teams             int,
  hero_link                   text,
  stage2_format               text check (stage2_format in ('single','double')),
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table tournaments enable row level security;

create policy "Public can read tournaments"
  on tournaments for select using (true);

create policy "Admins can insert tournaments"
  on tournaments for insert
  with check (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

create policy "Admins can update tournaments"
  on tournaments for update
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

create policy "Admins can delete tournaments"
  on tournaments for delete
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── TOURNAMENT TEAMS ────────────────────────────────────────
create table if not exists tournament_teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name          text not null,
  logo_url      text,
  created_at    timestamptz not null default now()
);

create index on tournament_teams(tournament_id);

alter table tournament_teams enable row level security;

create policy "Public can read tournament_teams"
  on tournament_teams for select using (true);

create policy "Admins can manage tournament_teams"
  on tournament_teams for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── TOURNAMENT PLAYERS ──────────────────────────────────────
create table if not exists tournament_players (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references tournament_teams(id) on delete cascade,
  name        text not null,
  riot_id     text,
  role        text check (role in ('igl','duelist','controller','sentinel','initiator')),
  photo_url   text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index on tournament_players(team_id);

alter table tournament_players enable row level security;

create policy "Public can read tournament_players"
  on tournament_players for select using (true);

create policy "Admins can manage tournament_players"
  on tournament_players for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── STAGE 1 CONFIGS ─────────────────────────────────────────
create table if not exists stage1_configs (
  id                          uuid primary key default gen_random_uuid(),
  tournament_id               uuid not null unique references tournaments(id) on delete cascade,
  format                      text not null check (format in ('single','double','roundrobin','groupstage')),
  qualifiers_count            int,
  teams_qualifying_per_group  int,
  created_at                  timestamptz not null default now()
);

alter table stage1_configs enable row level security;

create policy "Public can read stage1_configs"
  on stage1_configs for select using (true);

create policy "Admins can manage stage1_configs"
  on stage1_configs for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── GROUPS ──────────────────────────────────────────────────
create table if not exists groups (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0
);

create index on groups(tournament_id);

alter table groups enable row level security;

create policy "Public can read groups"
  on groups for select using (true);

create policy "Admins can manage groups"
  on groups for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── GROUP TEAMS ─────────────────────────────────────────────
create table if not exists group_teams (
  group_id  uuid not null references groups(id) on delete cascade,
  team_id   uuid not null references tournament_teams(id) on delete cascade,
  wins      int not null default 0,
  losses    int not null default 0,
  primary key (group_id, team_id)
);

alter table group_teams enable row level security;

create policy "Public can read group_teams"
  on group_teams for select using (true);

create policy "Admins can manage group_teams"
  on group_teams for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── BRACKET MATCHES ─────────────────────────────────────────
create table if not exists bracket_matches (
  id                       uuid primary key default gen_random_uuid(),
  tournament_id            uuid not null references tournaments(id) on delete cascade,
  stage                    text not null default 'main' check (stage in ('main','stage1','stage2')),
  bracket_section          text check (bracket_section in ('winners','losers','grand-final')),
  bracket_type             text check (bracket_type in ('single','double','roundrobin')),
  round                    int not null default 0,
  position                 int not null default 0,
  team1_id                 uuid references tournament_teams(id),
  team2_id                 uuid references tournament_teams(id),
  team1_name               text,
  team2_name               text,
  winner_id                uuid references tournament_teams(id),
  format                   text not null default 'bo3' check (format in ('bo1','bo3','bo5')),
  scheduled_date           date,
  scheduled_time           time,
  winner_goes_to_match_id  uuid references bracket_matches(id),
  winner_goes_to_slot      int,
  loser_goes_to_match_id   uuid references bracket_matches(id),
  loser_goes_to_slot       int,
  auto_populated           boolean not null default false,
  needs_assignment         boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index on bracket_matches(tournament_id);
create index on bracket_matches(tournament_id, stage, round);

alter table bracket_matches enable row level security;

create policy "Public can read bracket_matches"
  on bracket_matches for select using (true);

create policy "Admins can manage bracket_matches"
  on bracket_matches for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── MATCH MAPS ──────────────────────────────────────────────
create table if not exists match_maps (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null references bracket_matches(id) on delete cascade,
  slot_index        int not null,
  map_name          text not null default '',
  team1_score       int not null default 0,
  team2_score       int not null default 0,
  valorant_match_id text,
  is_placeholder    boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (match_id, slot_index)
);

create index on match_maps(match_id);

alter table match_maps enable row level security;

create policy "Public can read match_maps"
  on match_maps for select using (true);

create policy "Admins can manage match_maps"
  on match_maps for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── MATCH PLAYER STATS ──────────────────────────────────────
create table if not exists match_player_stats (
  id           uuid primary key default gen_random_uuid(),
  map_id       uuid not null references match_maps(id) on delete cascade,
  player_id    uuid references tournament_players(id),
  team_id      uuid references tournament_teams(id),
  player_name  text not null,
  riot_id      text,
  agent        text,
  kills        int not null default 0,
  deaths       int not null default 0,
  assists      int not null default 0,
  kd           numeric(5,2),
  acs          int,
  hs_percent   int,
  created_at   timestamptz not null default now()
);

create index on match_player_stats(map_id);
create index on match_player_stats(team_id);

alter table match_player_stats enable row level security;

create policy "Public can read match_player_stats"
  on match_player_stats for select using (true);

create policy "Admins can manage match_player_stats"
  on match_player_stats for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── NEWS ITEMS ──────────────────────────────────────────────
create table if not exists news_items (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  category     text,
  image_url    text,
  link         text,
  visible      boolean not null default true,
  published_at timestamptz not null default now(),
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

alter table news_items enable row level security;

create policy "Public can read visible news"
  on news_items for select using (visible = true);

create policy "Admins can read all news"
  on news_items for select
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

create policy "Admins can manage news"
  on news_items for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── TOP PLAYERS ─────────────────────────────────────────────
create table if not exists top_players (
  id         uuid primary key default gen_random_uuid(),
  rank       int not null,
  name       text not null,
  team       text,
  rating     numeric(5,2),
  kills      int,
  deaths     int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table top_players enable row level security;

create policy "Public can read top_players"
  on top_players for select using (true);

create policy "Admins can manage top_players"
  on top_players for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- ─── SITE CONFIG ─────────────────────────────────────────────
create table if not exists site_config (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table site_config enable row level security;

create policy "Public can read site_config"
  on site_config for select using (true);

create policy "Admins can manage site_config"
  on site_config for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

-- Seed default config
insert into site_config (key, value) values
  ('hero_link', '')
on conflict (key) do nothing;

-- ─── STORAGE BUCKETS ─────────────────────────────────────────
-- Run these separately in Supabase Dashboard > Storage, or uncomment if your
-- Supabase project has storage enabled and the extension is available.
--
-- insert into storage.buckets (id, name, public) values ('team-logos', 'team-logos', true);
-- insert into storage.buckets (id, name, public) values ('player-photos', 'player-photos', true);
-- insert into storage.buckets (id, name, public) values ('news-images', 'news-images', true);

-- ─── UPDATED_AT TRIGGER ──────────────────────────────────────
create or replace function handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on tournaments
  for each row execute function handle_updated_at();

create trigger set_updated_at before update on bracket_matches
  for each row execute function handle_updated_at();

create trigger set_updated_at before update on top_players
  for each row execute function handle_updated_at();

create trigger set_updated_at before update on site_config
  for each row execute function handle_updated_at();
