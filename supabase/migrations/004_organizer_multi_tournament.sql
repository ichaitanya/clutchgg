-- 004_organizer_multi_tournament.sql
-- Multi-tournament organizers: one organizer can be scoped to many tournaments.
-- The junction table is the source of truth for scope; the legacy
-- profiles.tournament_id is kept (backfilled) as a "most-recent/primary" pointer.

CREATE TABLE IF NOT EXISTS public.organizer_tournaments (
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tournament_id)
);

ALTER TABLE public.organizer_tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage organizer_tournaments" ON public.organizer_tournaments;
CREATE POLICY "Staff manage organizer_tournaments" ON public.organizer_tournaments
  FOR ALL USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Organizers read own assignments" ON public.organizer_tournaments;
CREATE POLICY "Organizers read own assignments" ON public.organizer_tournaments
  FOR SELECT USING (user_id = auth.uid());

-- Returns the full set of tournament ids an organizer may manage.
CREATE OR REPLACE FUNCTION public.my_tournament_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT tournament_id FROM public.organizer_tournaments WHERE user_id = auth.uid()
  UNION
  SELECT tournament_id FROM public.profiles WHERE id = auth.uid() AND tournament_id IS NOT NULL;
$function$;

-- Backfill from existing single-column assignments.
INSERT INTO public.organizer_tournaments (user_id, tournament_id)
SELECT id, tournament_id FROM public.profiles
WHERE role = 'organizer' AND tournament_id IS NOT NULL
ON CONFLICT (user_id, tournament_id) DO NOTHING;

-- Switch organizer RLS to the set-based check.
DROP POLICY IF EXISTS "Organizers manage own tournament_blob" ON public.tournaments_blob;
CREATE POLICY "Organizers manage own tournament_blob" ON public.tournaments_blob
  FOR ALL
  USING (my_role() = 'organizer' AND id IN (SELECT public.my_tournament_ids()))
  WITH CHECK (my_role() = 'organizer' AND id IN (SELECT public.my_tournament_ids()));

DROP POLICY IF EXISTS "Organizers manage own tournament news" ON public.news_items;
CREATE POLICY "Organizers manage own tournament news" ON public.news_items
  FOR ALL
  USING (my_role() = 'organizer' AND tournament_id IN (SELECT public.my_tournament_ids()))
  WITH CHECK (my_role() = 'organizer' AND tournament_id IN (SELECT public.my_tournament_ids()));
