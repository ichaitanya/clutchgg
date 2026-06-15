-- 012_pickems_hardening.sql
-- Adversarial-audit hardening for pickems (010/011). Closes:
--   • Exploit 2: quota TOCTOU race — the cap was checked in the edge function
--     (read-then-write, no atomicity), so N concurrent submit-pick calls could
--     all pass `used < allowance` before any inserted. Now enforced atomically
--     at INSERT time inside a per-user advisory lock, so the DB is the source of
--     truth regardless of concurrency or a forged/replayed call.
--   • Exploit 3 + 6: referral farming / churn — a referral now only counts toward
--     the bonus once the REFERRED user has actually participated (made a pick),
--     not merely verified. Throwaway accounts that never play grant nothing.
--   • Exploit 7: an organizer must not score on their OWN tournament's pickems
--     (they can set the answers). Their picks are excluded from pickem_scores.

-- ════════════════════════════════════════════════════════════════════════════
-- Helper: is this user an organizer (or superadmin) of this tournament?
-- SECURITY DEFINER so it can read profiles/organizer_tournaments from any RLS
-- context. Used by the score-exclusion logic and re-usable elsewhere.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.manages_tournament(uid uuid, tid text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.role = 'superadmin')
    OR EXISTS (SELECT 1 FROM public.organizer_tournaments ot
               WHERE ot.user_id = uid AND ot.tournament_id = tid);
$function$;
REVOKE ALL ON FUNCTION public.manages_tournament(uuid, text) FROM anon, authenticated, public;

-- Batch variant used by grade-pickems to exclude organizer participants in one
-- round-trip: of the given user ids, which manage this tournament?
CREATE OR REPLACE FUNCTION public.managers_among(uids uuid[], tid text)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT u FROM unnest(uids) AS u
  WHERE public.manages_tournament(u, tid);
$function$;
REVOKE ALL ON FUNCTION public.managers_among(uuid[], text) FROM anon, authenticated, public;
-- Called by the grade-pickems edge function under the service role.

-- ════════════════════════════════════════════════════════════════════════════
-- Exploit 3 + 6: a referral "counts" only once the referred user has both
-- verified AND made at least one pick. Centralised here so pickem_quota and any
-- future surface agree. (Churn note: deleting/recreating an account drops the old
-- referral's referred_id to NULL via the FK, so a re-created account starts from
-- zero picks — it can't re-trigger the bonus without playing again.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.counted_referrals(uid uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT count(*)::int
  FROM public.referrals r
  WHERE r.referrer_id = uid
    AND r.status = 'verified'
    AND EXISTS (SELECT 1 FROM public.pickem_picks p WHERE p.user_id = r.referred_id);
$function$;
REVOKE ALL ON FUNCTION public.counted_referrals(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.counted_referrals(uuid) TO authenticated;

-- pickem_quota now uses counted_referrals (participation-gated) for the bonus.
CREATE OR REPLACE FUNCTION public.pickem_quota(uid uuid)
RETURNS TABLE (used int, allowance int, unlimited boolean, verified_referrals int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_refs int;
BEGIN
  v_refs := public.counted_referrals(uid);
  verified_referrals := v_refs;
  unlimited := v_refs >= 3;
  allowance := 10 + 5 * least(v_refs, 3);
  SELECT count(*) INTO used
    FROM public.pickem_picks p
    JOIN public.pickem_questions q ON q.id = p.question_id
    WHERE p.user_id = uid AND q.status <> 'void';
  RETURN NEXT;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.pickem_quota(uuid) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Exploit 2: atomic quota enforcement at INSERT time.
-- A BEFORE INSERT trigger that (a) serialises concurrent inserts for the SAME
-- user via a per-user transaction advisory lock, then (b) refuses the insert if
-- the user is already at/over their allowance. Because the lock is held for the
-- rest of the transaction, two racing inserts can't both pass the count check.
-- service_role (the submit-pick fn) and ordinary paths alike are bound by this —
-- it's the real source of truth; the edge-function check is now just a fast UX
-- pre-check. An UPDATE (changing an existing pick) never hits this.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.enforce_pickem_quota()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_allowance int;
  v_unlimited boolean;
  v_used int;
BEGIN
  -- Serialise per user so the count below can't be read stale by a racing insert.
  PERFORM pg_advisory_xact_lock(hashtext('pickem_quota:' || NEW.user_id::text));

  SELECT allowance, unlimited INTO v_allowance, v_unlimited
  FROM public.pickem_quota(NEW.user_id);

  IF v_unlimited THEN
    RETURN NEW;
  END IF;

  -- Count this user's existing non-void picks (the same definition pickem_quota
  -- uses). A brand-new pick must fit within allowance.
  SELECT count(*) INTO v_used
  FROM public.pickem_picks p
  JOIN public.pickem_questions q ON q.id = p.question_id
  WHERE p.user_id = NEW.user_id AND q.status <> 'void';

  IF v_used >= v_allowance THEN
    RAISE EXCEPTION 'pickem quota exceeded'
      USING ERRCODE = 'check_violation', HINT = 'quota_exceeded';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_pickem_quota() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS enforce_pickem_quota ON public.pickem_picks;
CREATE TRIGGER enforce_pickem_quota
  BEFORE INSERT ON public.pickem_picks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pickem_quota();

-- ════════════════════════════════════════════════════════════════════════════
-- Exploit 4: blunt loop-abuse of the heavy grade-pickems recompute with a tiny
-- per-tournament cooldown ledger. grade-pickems claims a slot via
-- claim_grade_slot(); if the previous grade was < cooldown seconds ago it returns
-- false and the function backs off. Not a hard security boundary (the org is
-- already authorized) — just stops an accidental/abusive tight loop from
-- re-reading the blob and rewriting every pick dozens of times a second.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pickem_grade_log (
  tournament_id text PRIMARY KEY,
  last_grade_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pickem_grade_log ENABLE ROW LEVEL SECURITY;
-- No policies → no client access at all; only the service role touches it.

CREATE OR REPLACE FUNCTION public.claim_grade_slot(tid text, cooldown_secs int DEFAULT 3)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_last timestamptz;
BEGIN
  SELECT last_grade_at INTO v_last FROM public.pickem_grade_log WHERE tournament_id = tid;
  IF v_last IS NOT NULL AND now() - v_last < make_interval(secs => cooldown_secs) THEN
    RETURN false; -- too soon
  END IF;
  INSERT INTO public.pickem_grade_log (tournament_id, last_grade_at)
  VALUES (tid, now())
  ON CONFLICT (tournament_id) DO UPDATE SET last_grade_at = now();
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_grade_slot(text, int) FROM anon, authenticated, public;

-- ════════════════════════════════════════════════════════════════════════════
-- Exploit 7: organizers don't score on their own tournament. The leaderboard
-- reads pickem_scores; we keep the recompute logic in grade-pickems but add a
-- guard view the frontend can use, AND we make the recompute skip organizer rows
-- (handled in the edge function). Here we also provide a function the grade fn
-- calls to know who to skip. (Frontend leaderboard already reads pickem_scores;
-- excluding at write-time keeps reads simple.)
-- No DDL needed beyond manages_tournament above — grade-pickems v3 uses it.
