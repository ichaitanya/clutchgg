-- 008_player_claims.sql
-- "Claim your tournament profile": a verified player (Google+Discord linked)
-- proves ownership of a tournament player card by re-authing Discord with the
-- `connections` scope; the verify-riot-claim edge function compares the
-- Discord-verified Riot ID against the card's riotId and inserts a claim here.
-- A superadmin approves/rejects via the decide-claim edge function.
--
-- SECURITY MODEL: clients can NOT insert or update claims — there are no
-- INSERT/UPDATE policies, so all writes go through the edge functions with the
-- service role. This is what makes a claim trustworthy: the riot-match check
-- happened server-side against Discord's API, never in the browser.

CREATE TABLE public.player_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.player_accounts(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  player_id text NOT NULL,
  player_name text,
  riot_id text NOT NULL,            -- snapshot of the Discord-verified connection at claim time
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid
);

-- One live (pending or approved) claim per player card. Rejected claims don't
-- block a re-claim. The edge function maps 23505 → "claim_taken".
CREATE UNIQUE INDEX one_active_claim_per_card
  ON public.player_claims (tournament_id, player_id)
  WHERE status <> 'rejected';

-- Fast lookups: claims by user (profile page) and pending queue (admin).
CREATE INDEX player_claims_user_idx ON public.player_claims (user_id);
CREATE INDEX player_claims_status_idx ON public.player_claims (status);

ALTER TABLE public.player_claims ENABLE ROW LEVEL SECURITY;

-- Approved claims are public (the player page shows the claimed profile to
-- everyone). Pending/rejected are visible only to the claimant and superadmins
-- (approval queue).
CREATE POLICY "Read claims" ON public.player_claims
  FOR SELECT USING (
    status = 'approved'
    OR auth.uid() = user_id
    OR is_superadmin()
  );

-- RLS policies don't grant table privileges by themselves.
GRANT SELECT ON public.player_claims TO anon, authenticated;
