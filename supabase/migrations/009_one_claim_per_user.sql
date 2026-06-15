-- 009_one_claim_per_user.sql
-- Enforce: a user may hold at most ONE active (pending or approved) claim at a
-- time. The same real player gets the SAME player card everywhere, so there's
-- never a reason to hold two — to claim a different card they must first
-- unclaim the current one (self-service or via a superadmin). A rejected claim
-- doesn't count (they may try again elsewhere).
--
-- This is the authoritative guard; the edge function maps the resulting 23505
-- to a friendly "already_claimed" status, and the UI hides the claim button.

CREATE UNIQUE INDEX one_active_claim_per_user
  ON public.player_claims (user_id)
  WHERE status <> 'rejected';
