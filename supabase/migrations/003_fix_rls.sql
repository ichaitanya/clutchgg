-- ============================================================
-- Migration 003: Fix RLS policies
-- Replace profile-lookup policies with simpler auth.uid() IS NOT NULL
-- to avoid recursive RLS evaluation that silently blocks writes.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- ─── tournaments_blob ─────────────────────────────────────────
drop policy if exists "Admins can manage tournaments_blob" on tournaments_blob;
create policy "Authenticated users can manage tournaments_blob"
  on tournaments_blob for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ─── news_items ───────────────────────────────────────────────
drop policy if exists "Admins can manage news" on news_items;
drop policy if exists "Admins can read all news" on news_items;
create policy "Authenticated users can manage news"
  on news_items for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ─── top_players ──────────────────────────────────────────────
drop policy if exists "Admins can manage top_players" on top_players;
create policy "Authenticated users can manage top_players"
  on top_players for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ─── standings ────────────────────────────────────────────────
drop policy if exists "Admins can manage standings" on standings;
create policy "Authenticated users can manage standings"
  on standings for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ─── site_config ──────────────────────────────────────────────
drop policy if exists "Admins can manage site_config" on site_config;
create policy "Authenticated users can manage site_config"
  on site_config for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ─── profiles ─────────────────────────────────────────────────
drop policy if exists "Admins can read all profiles" on profiles;
drop policy if exists "Users can read own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;
create policy "Authenticated users can read own profile"
  on profiles for select
  using (auth.uid() = id);
create policy "Authenticated users can manage own profile"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);
