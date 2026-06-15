-- 013_pickems_publish.sql
-- Pickems lifecycle: draft → published, and graded → results-published.
--
-- Requirements implemented:
--   • A match's pickems are HIDDEN from players until the organizer PUBLISHES
--     them (per-match). Draft questions are visible only to staff/organizers.
--   • Before publish: an organizer can add/edit/remove questions.
--   • After publish: an organizer can NO LONGER edit questions — only a
--     SUPERADMIN can (enforced in manage-pickem-question v2). Organizers keep
--     answer/result control.
--   • Grading computes answers, but correctness + points are only REVEALED to
--     players once the organizer PUBLISHES RESULTS (after reviewing pulled stats).
--   • Lock stays schedule-driven (submit-pick derives it live) — unchanged.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Per-match publish state
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.pickem_match_state (
  tournament_id     text NOT NULL,
  match_id          text NOT NULL,
  published         boolean NOT NULL DEFAULT false,  -- questions visible to players
  results_published boolean NOT NULL DEFAULT false,  -- correctness/points revealed
  published_at      timestamptz,
  published_by      uuid,
  results_published_at timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, match_id)
);

ALTER TABLE public.pickem_match_state ENABLE ROW LEVEL SECURITY;

-- Public read so the play view (and anyone) can tell which matches are live and
-- whether results are out. No client write — flipped only by edge functions.
CREATE POLICY "Public read match state" ON public.pickem_match_state
  FOR SELECT USING (true);
GRANT SELECT ON public.pickem_match_state TO anon, authenticated;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pickem_match_state
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Helper: is a given match published? SECURITY DEFINER so it can be used inside
-- the pickem_questions RLS policy regardless of the caller.
CREATE OR REPLACE FUNCTION public.match_is_published(tid text, mid text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT published FROM public.pickem_match_state WHERE tournament_id = tid AND match_id = mid),
    false);
$function$;
GRANT EXECUTE ON FUNCTION public.match_is_published(text, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Restrict question visibility to PUBLISHED matches (players), with staff +
--    scoped organizers still seeing drafts so they can author/review.
-- ════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Public read pickem questions" ON public.pickem_questions;
CREATE POLICY "Read published or as staff" ON public.pickem_questions
  FOR SELECT USING (
    public.match_is_published(tournament_id, match_id)
    OR public.is_staff()
    OR public.manages_tournament(auth.uid(), tournament_id)
  );

-- Likewise, the pick-distribution view should only expose published matches.
-- (It already filters to locked/graded/void questions; add the publish gate.)
DROP VIEW IF EXISTS public.pickem_pick_distribution;
CREATE VIEW public.pickem_pick_distribution
WITH (security_invoker = false) AS
  SELECT p.tournament_id, p.question_id, p.option_id, count(*)::int AS votes
  FROM public.pickem_picks p
  JOIN public.pickem_questions q ON q.id = p.question_id
  JOIN public.pickem_match_state ms
    ON ms.tournament_id = q.tournament_id AND ms.match_id = q.match_id
  WHERE q.status IN ('locked','graded','void')
    AND ms.published = true
  GROUP BY p.tournament_id, p.question_id, p.option_id;
GRANT SELECT ON public.pickem_pick_distribution TO anon, authenticated;

-- manages_tournament is called from RLS policies by both authenticated (organizers)
-- and anon (players reading published questions) users. RLS policy expressions run
-- with the caller's privileges, so both roles MUST have EXECUTE (same rule as
-- my_tournament_ids per organizer-auth-model).
GRANT EXECUTE ON FUNCTION public.manages_tournament(uuid, text) TO anon, authenticated;
