-- 011_pickems_fixes.sql
-- Follow-up fixes to the pickems system (010) found in a workflow/logic-gap audit:
--   • Gap 7: a pick on a question that ends up VOID must not consume the user's
--            quota. Quota now counts only picks whose question is not void.
--   • Gap 11: a referral counts only while the referred user stays fully verified.
--            If they unlink a provider (lose is_verified), the referral reverts
--            from 'verified' back to 'pending' so it stops granting +5.

-- ── Gap 7: void picks don't count toward quota ──────────────────────────────
CREATE OR REPLACE FUNCTION public.pickem_quota(uid uuid)
RETURNS TABLE (used int, allowance int, unlimited boolean, verified_referrals int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_refs int;
BEGIN
  SELECT count(*) INTO v_refs
    FROM public.referrals WHERE referrer_id = uid AND status = 'verified';
  verified_referrals := v_refs;
  unlimited := v_refs >= 3;
  allowance := 10 + 5 * least(v_refs, 3);

  -- Count the user's picks EXCEPT those on questions that were voided — a void
  -- question awards nobody, so it shouldn't burn anyone's allowance either.
  SELECT count(*) INTO used
    FROM public.pickem_picks p
    JOIN public.pickem_questions q ON q.id = p.question_id
    WHERE p.user_id = uid AND q.status <> 'void';

  RETURN NEXT;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.pickem_quota(uuid) TO anon, authenticated;

-- ── Gap 11: referral reverts to pending when the referred user de-verifies ──
-- Replaces the one-way mark_referral_verified (010): now it sets verified when
-- both providers are linked, and reverts to pending when they aren't — so the
-- +5 / unlimited bonus only persists while the invited player stays verified.
CREATE OR REPLACE FUNCTION public.mark_referral_verified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.google_linked AND NEW.discord_linked) THEN
    UPDATE public.referrals
       SET status = 'verified', verified_at = now()
     WHERE referred_id = NEW.id AND status = 'pending';
  ELSE
    UPDATE public.referrals
       SET status = 'pending', verified_at = NULL
     WHERE referred_id = NEW.id AND status = 'verified';
  END IF;
  RETURN NULL;
END;
$function$;

-- ── Gap 9: let the distribution view be filtered by tournament ──────────────
-- Add tournament_id so the play view fetches only the current tournament's
-- distribution instead of every locked question site-wide. Still aggregate-only
-- (no per-user rows), still post-lock only.
DROP VIEW IF EXISTS public.pickem_pick_distribution;
CREATE VIEW public.pickem_pick_distribution
WITH (security_invoker = false) AS
  SELECT p.tournament_id, p.question_id, p.option_id, count(*)::int AS votes
  FROM public.pickem_picks p
  JOIN public.pickem_questions q ON q.id = p.question_id
  WHERE q.status IN ('locked','graded','void')
  GROUP BY p.tournament_id, p.question_id, p.option_id;
GRANT SELECT ON public.pickem_pick_distribution TO anon, authenticated;
