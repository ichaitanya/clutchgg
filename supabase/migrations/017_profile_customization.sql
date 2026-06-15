-- ════════════════════════════════════════════════════════════════════════════
-- 017_profile_customization.sql
-- Secure avatar + bio customization for player_accounts.
--
-- Design constraints (carried over from 006/016):
--   • player_accounts is the PLAYER table; clients hold self UPDATE on it and
--     legitimately write display_name / socials / riot_id from the browser
--     (upsertPlayerAccount). We must NOT take that away.
--   • avatar_url and bio, however, must only ever be set through the
--     `update-profile` edge function, which validates the image, runs moderation,
--     and enforces rate limits. So we FREEZE those two columns for every writer
--     except service_role (the edge function), exactly like 005 froze role/
--     tournament_id on profiles.
--   • The bio CHECK stays <= 500 (006) so no existing longer bio row is
--     invalidated; the 250-char product limit is enforced in the edge function
--     and the UI. Widening here, narrowing in app code, is the safe direction.
--
-- Nothing here changes staff/profiles logic or the existing identity-sync
-- trigger (006); this trigger runs alongside it.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. New columns ──────────────────────────────────────────────────────────
-- Timestamps power the rate limiter (last change) and "edited" UI; the *_count
-- + *_window_start pairs are the per-rolling-24h counters the edge function
-- reads and bumps. Counters live here (not a side table) so a single row write
-- updates them atomically with the value.
ALTER TABLE public.player_accounts
  ADD COLUMN IF NOT EXISTS avatar_updated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS bio_updated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS avatar_change_count integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_window_start timestamptz,
  ADD COLUMN IF NOT EXISTS bio_change_count    integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bio_window_start    timestamptz;

-- ── 2. Freeze avatar_url / bio + the rate-limit bookkeeping for clients ──────
-- RLS can't restrict WHICH columns an UPDATE touches, so this BEFORE trigger
-- does. service_role (edge function) bypasses RLS *and* triggers, so it sets
-- these freely; everyone else gets the OLD values forced back. A client trying
-- to sneak avatar_url/bio (or to reset its own rate-limit counters) through the
-- normal self-update path is silently no-op'd on those columns — its
-- display_name/socials/riot_id changes still go through.
CREATE OR REPLACE FUNCTION public.guard_player_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role (edge functions) is fully trusted here.
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- On self-insert (first OAuth sign-in via ensurePlayerAccount), the row is
    -- brand new. We ALLOW avatar_url here because the only legitimate caller
    -- seeds it from the OAuth provider's own picture (meta.avatar_url/picture) —
    -- a trustworthy URL, not free-form user input — and losing that would drop
    -- the auto-imported Google/Discord photo. We still forbid seeding a bio
    -- (no provider supplies one; any value here would be unmoderated user input)
    -- and force the rate-limit bookkeeping to its zero state. Subsequent avatar
    -- changes go through the moderated edge function (frozen on UPDATE below).
    NEW.bio                 := NULL;
    NEW.avatar_updated_at   := NULL;
    NEW.bio_updated_at      := NULL;
    NEW.avatar_change_count := 0;
    NEW.avatar_window_start := NULL;
    NEW.bio_change_count    := 0;
    NEW.bio_window_start    := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: pin every protected column to its existing value.
  NEW.avatar_url          := OLD.avatar_url;
  NEW.bio                 := OLD.bio;
  NEW.avatar_updated_at   := OLD.avatar_updated_at;
  NEW.bio_updated_at      := OLD.bio_updated_at;
  NEW.avatar_change_count := OLD.avatar_change_count;
  NEW.avatar_window_start := OLD.avatar_window_start;
  NEW.bio_change_count    := OLD.bio_change_count;
  NEW.bio_window_start    := OLD.bio_window_start;
  RETURN NEW;
END;
$function$;

-- Must run BEFORE the existing identity-sync trigger so both BEFORE triggers see
-- consistent NEW values. Postgres fires BEFORE triggers in name order; "guard_"
-- sorts before "sync_", which is the order we want (freeze, then sync flags).
DROP TRIGGER IF EXISTS guard_player_profile_columns ON public.player_accounts;
CREATE TRIGGER guard_player_profile_columns
  BEFORE INSERT OR UPDATE ON public.player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_player_profile_columns();

REVOKE ALL ON FUNCTION public.guard_player_profile_columns() FROM anon, authenticated, public;

-- ── 3. Expose the new safe columns to readers ───────────────────────────────
-- 016 replaced the table-wide SELECT grant with a column-list grant. The
-- *_updated_at fields are harmless public metadata ("edited" indicator), so add
-- them. The rate-limit counters/windows are NOT granted — they're internal and
-- only the edge function (service_role) needs them. The own-row editor reads
-- them via get_my_player_account() (SECURITY DEFINER, already returns all cols).
GRANT SELECT (avatar_updated_at, bio_updated_at)
  ON public.player_accounts TO anon, authenticated;

-- ── 4. Tighten the avatars storage bucket to the single canonical object ─────
-- 006 allowed writes anywhere under avatars/<uid>/… . The new pipeline stores
-- exactly ONE object per user — avatars/<uid>.webp — and the edge function
-- (service_role) is what writes it. Restrict the public/own-folder upload
-- policies so a client can't stash arbitrary unmoderated files in the bucket.
-- (service_role bypasses these, so the edge function still writes/overwrites.)
--
-- We keep DELETE/UPDATE on the user's own object so a fallback client cleanup
-- still works, but drop client INSERT of new arbitrary paths.
DROP POLICY IF EXISTS "Players upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Players update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Players delete own avatar" ON storage.objects;

-- Only the canonical "<uid>.webp" object, only by its owner. The edge function
-- (service_role) is the normal writer; this policy is a defence-in-depth floor.
CREATE POLICY "Player owns canonical avatar" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '.webp'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '.webp'
  );
