-- 010_pickems.sql
-- Tournament Pickems: per-match prediction questions, player picks, a per-tournament
-- leaderboard, and a referral-based participation quota.
--
-- SECURITY MODEL (mirrors player_claims / migration 008): the trustworthy tables carry
-- NO client INSERT/UPDATE policy. Every grading-sensitive write — submitting a pick,
-- seeding/editing questions, grading, recording a referral — goes through an Edge Function
-- running with the service role, which re-validates against the (mutable) tournaments_blob
-- and the verified-identity flags. Clients can only READ. This is what prevents:
--   • picking after a match locks (lock derived live from the match date/time, server-side)
--   • forging is_correct / points / leaderboard standings (no client write path at all)
--   • inflating the pick quota (counted server-side from pickem_picks)
--   • farming referrals (a referral only counts once the referred user is fully verified;
--     one per distinct referred user; self-referral blocked)
--
-- Depends on: player_accounts (006), is_superadmin()/my_tournament_ids() (005/004),
-- handle_updated_at() (001), organizer_tournaments (004).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Referral columns on player_accounts
-- ════════════════════════════════════════════════════════════════════════════
-- referral_code: stable, shareable per-user code (generated once, immutable).
-- referred_by:   who invited this account; write-once, set only at creation by the
--                claim-referral edge function (service role).
ALTER TABLE public.player_accounts
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by  uuid REFERENCES public.player_accounts(id) ON DELETE SET NULL;

-- Backfill a code for any existing account, then make it NOT NULL with a default for
-- new rows. Codes are short, URL-safe, and collision-checked by the unique index
-- (a dup simply retries at the app/edge layer; the default below is best-effort).
UPDATE public.player_accounts
  SET referral_code = lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 10))
  WHERE referral_code IS NULL;

ALTER TABLE public.player_accounts
  ALTER COLUMN referral_code SET DEFAULT lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
  ALTER COLUMN referral_code SET NOT NULL;

-- Freeze referral_code + referred_by against client tampering. referral_code is
-- immutable once set; referred_by may only ever go from NULL → a value, and never be
-- changed once set. service_role bypasses (the claim-referral edge function sets
-- referred_by exactly once at account creation). Runs alongside the existing
-- sync_player_identity_flags BEFORE trigger.
CREATE OR REPLACE FUNCTION public.guard_player_referral_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- referral_code can never change after it exists.
    IF NEW.referral_code IS DISTINCT FROM OLD.referral_code AND OLD.referral_code IS NOT NULL THEN
      RAISE EXCEPTION 'Not allowed to change referral_code';
    END IF;
    -- referred_by is write-once: NULL→value is reserved for service_role (blocked here),
    -- value→anything is always blocked.
    IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
      RAISE EXCEPTION 'Not allowed to change referred_by';
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- A self-insert (OAuth bootstrap) must not pre-set its own referrer.
    NEW.referred_by := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_player_referral_columns() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS guard_player_referral_columns ON public.player_accounts;
CREATE TRIGGER guard_player_referral_columns
  BEFORE INSERT OR UPDATE ON public.player_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_player_referral_columns();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. referrals — the referral graph and quota source of truth
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referrals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  referred_id uuid UNIQUE REFERENCES public.player_accounts(id) ON DELETE SET NULL,
  code        text,                                  -- the code used (audit)
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  CONSTRAINT referrals_no_self CHECK (referrer_id <> referred_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id, status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- A user can see referrals they made (to render their invite progress). No client
-- write path — claim-referral (service role) creates rows; the verification trigger
-- flips them to 'verified'.
CREATE POLICY "Read own referrals" ON public.referrals
  FOR SELECT USING (auth.uid() = referrer_id OR is_superadmin());

GRANT SELECT ON public.referrals TO anon, authenticated;

-- Flip pending referrals to verified the moment the referred user becomes fully
-- verified (Google + Discord). A dedicated AFTER trigger so the critical
-- sync_player_identity_flags function (006) stays untouched. is_verified is a
-- generated column, so we test the underlying flags directly.
CREATE OR REPLACE FUNCTION public.mark_referral_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.google_linked AND NEW.discord_linked) THEN
    UPDATE public.referrals
       SET status = 'verified', verified_at = now()
     WHERE referred_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NULL; -- AFTER trigger
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_referral_verified() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS mark_referral_verified ON public.player_accounts;
CREATE TRIGGER mark_referral_verified
  AFTER INSERT OR UPDATE OF google_linked, discord_linked ON public.player_accounts
  FOR EACH ROW EXECUTE FUNCTION public.mark_referral_verified();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. pickem_questions — authored per match (lives in the DB, not the blob)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pickem_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     text NOT NULL,
  match_id          text NOT NULL,                 -- BracketMatch.id inside the blob
  stage             text,                          -- 'stage1' | 'stage2' | 'single'
  kind              text NOT NULL CHECK (kind IN
                      ('match_winner','map_winner','map_score','top_acs','mvp','custom')),
  prompt            text NOT NULL,
  options           jsonb NOT NULL DEFAULT '[]',    -- [{id, label, meta?{teamId,playerId}}]
  auto_grade        boolean NOT NULL DEFAULT true,
  map_index         int,                            -- for map_winner / map_score
  points            int NOT NULL DEFAULT 2 CHECK (points >= 0),
  sort_order        int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','graded','void')),
  correct_option_id text,                           -- set ONLY by grade-pickems (service role)
  locks_at          timestamptz,                    -- snapshot of match date+time; null => derive live
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Natural key for idempotent seeding: one question per (match, kind, map slot).
-- COALESCE(map_index,-1) so the unique index treats "no map" as a single slot.
CREATE UNIQUE INDEX IF NOT EXISTS pickem_questions_natural_key
  ON public.pickem_questions (tournament_id, match_id, kind, COALESCE(map_index, -1))
  WHERE kind <> 'custom';   -- custom questions can repeat; auto ones are unique per slot

CREATE INDEX IF NOT EXISTS pickem_questions_match_idx
  ON public.pickem_questions (tournament_id, match_id, sort_order);
CREATE INDEX IF NOT EXISTS pickem_questions_status_idx
  ON public.pickem_questions (tournament_id, status);

ALTER TABLE public.pickem_questions ENABLE ROW LEVEL SECURITY;

-- Questions are public content. No client write path — seed/manage edge functions
-- (service role) own all writes so the ≥5 rule, blob existence, and the freeze on
-- correct_option_id/status are enforced server-side.
CREATE POLICY "Public read pickem questions" ON public.pickem_questions
  FOR SELECT USING (true);

GRANT SELECT ON public.pickem_questions TO anon, authenticated;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pickem_questions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. pickem_picks — a user's answer to a question
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pickem_picks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  question_id    uuid NOT NULL REFERENCES public.pickem_questions(id) ON DELETE CASCADE,
  tournament_id  text NOT NULL,                     -- denormalized for leaderboard/quota
  option_id      text NOT NULL,                     -- must exist in question.options
  is_correct     boolean,                           -- null until graded; grade fn only
  points_awarded int NOT NULL DEFAULT 0,            -- grade fn only
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS pickem_picks_user_idx ON public.pickem_picks (user_id);
CREATE INDEX IF NOT EXISTS pickem_picks_tournament_idx ON public.pickem_picks (tournament_id);
CREATE INDEX IF NOT EXISTS pickem_picks_question_idx ON public.pickem_picks (question_id);

ALTER TABLE public.pickem_picks ENABLE ROW LEVEL SECURITY;

-- A user can read ONLY their own picks (so live picks can't be copied off the wire).
-- "What others picked" is exposed post-lock through the aggregate view below, never
-- through this table. No client INSERT/UPDATE — submit-pick (service role) is the only
-- write path (it enforces verification + live lock + quota atomically).
CREATE POLICY "Read own picks" ON public.pickem_picks
  FOR SELECT USING (auth.uid() = user_id);

GRANT SELECT ON public.pickem_picks TO authenticated;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pickem_picks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. pickem_scores — materialized per-user-per-tournament leaderboard
-- ════════════════════════════════════════════════════════════════════════════
-- Recomputed by grade-pickems on every grade. Public read; no client write — keeps
-- the leaderboard tamper-proof (the exact class of bug 005 fixed for `standings`,
-- where any logged-in user could overwrite site-wide standings).
CREATE TABLE IF NOT EXISTS public.pickem_scores (
  user_id       uuid NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  points        int NOT NULL DEFAULT 0,
  correct_count int NOT NULL DEFAULT 0,
  total_picks   int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tournament_id)
);

CREATE INDEX IF NOT EXISTS pickem_scores_leaderboard_idx
  ON public.pickem_scores (tournament_id, points DESC);

ALTER TABLE public.pickem_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read pickem scores" ON public.pickem_scores
  FOR SELECT USING (true);

GRANT SELECT ON public.pickem_scores TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. pickem_pick_distribution — public, post-lock "what everyone picked"
-- ════════════════════════════════════════════════════════════════════════════
-- A SECURITY DEFINER view exposing per-option pick COUNTS, but only for questions that
-- are locked/graded/void (never while open). It returns aggregates only — never which
-- user picked what — so it leaks nothing exploitable and lets the play view show
-- community sentiment after lock. security_invoker=false so it can read pickem_picks
-- past the per-user RLS policy; callers still can't see individual rows.
CREATE OR REPLACE VIEW public.pickem_pick_distribution
WITH (security_invoker = false) AS
  SELECT
    p.question_id,
    p.option_id,
    count(*)::int AS votes
  FROM public.pickem_picks p
  JOIN public.pickem_questions q ON q.id = p.question_id
  WHERE q.status IN ('locked','graded','void')
  GROUP BY p.question_id, p.option_id;

GRANT SELECT ON public.pickem_pick_distribution TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. pickem_quota(uid) — server-authoritative quota for a user
-- ════════════════════════════════════════════════════════════════════════════
-- 10 free picks, +5 per VERIFIED referral, UNLIMITED once a user has ≥3 verified
-- referrals. `used` = total picks across all tournaments (global). SECURITY DEFINER so
-- it can count referrals/picks regardless of the caller; returns only the caller-
-- relevant numbers. EXECUTE kept for authenticated/anon (per the my_role() rule — RLS
-- helper fns called by policies/clients must stay executable). Callers should pass
-- auth.uid(); the function does not trust a foreign uid for anything but its own counts.
CREATE OR REPLACE FUNCTION public.pickem_quota(uid uuid)
RETURNS TABLE (used int, allowance int, unlimited boolean, verified_referrals int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_refs int;
BEGIN
  SELECT count(*) INTO v_refs
    FROM public.referrals
    WHERE referrer_id = uid AND status = 'verified';

  verified_referrals := v_refs;
  unlimited := v_refs >= 3;
  allowance := 10 + 5 * least(v_refs, 3);   -- 10 / 15 / 20 / (25 == unlimited)

  SELECT count(*) INTO used
    FROM public.pickem_picks
    WHERE user_id = uid;

  RETURN NEXT;
END;
$function$;

-- Mirrors the documented rule for my_role()/my_tournament_ids(): DO NOT revoke EXECUTE
-- from authenticated/anon — the app calls this via RPC and it returns only the caller's
-- own counts (a foreign uid still only reveals aggregate counts, nothing sensitive).
GRANT EXECUTE ON FUNCTION public.pickem_quota(uuid) TO anon, authenticated;
