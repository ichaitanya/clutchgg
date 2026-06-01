-- ============================================================
-- clutchgg — Migration 002: Blob tables
-- The tournament structure is deeply nested (brackets, maps, player stats).
-- We store the full tournament as jsonb for safe migration; normalized tables
-- (bracket_matches, match_maps, match_player_stats) can be populated later.
-- Run this in Supabase SQL Editor after 001_initial_schema.sql
-- ============================================================

-- ─── TOURNAMENTS BLOB ────────────────────────────────────────
create table if not exists tournaments_blob (
  id          text primary key,       -- matches the client-side Tournament.id
  data        jsonb not null,         -- full Tournament object
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table tournaments_blob enable row level security;

create policy "Public can read tournaments_blob"
  on tournaments_blob for select using (true);

create policy "Admins can manage tournaments_blob"
  on tournaments_blob for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));

create trigger set_updated_at before update on tournaments_blob
  for each row execute function handle_updated_at();

-- ─── STANDINGS ───────────────────────────────────────────────
-- Simple flat table for the public leaderboard
create table if not exists standings (
  id      text primary key,
  rank    int not null,
  name    text not null,
  wins    int not null default 0,
  losses  int not null default 0
);

alter table standings enable row level security;

create policy "Public can read standings"
  on standings for select using (true);

create policy "Admins can manage standings"
  on standings for all
  using (auth.uid() in (select id from profiles where role in ('admin','superadmin')));
