-- ════════════════════════════════════════════════════════════════════════════
-- cleanup_orphaned_avatars.sql  (one-off / on-demand maintenance, NOT a migration)
--
-- Background: before migration 017 the avatar flow stored timestamped files at
--   avatars/<uid>/avatar-<ts>.<ext>
-- and never deleted the previous one. The new flow stores exactly ONE canonical
-- object per user:
--   avatars/<uid>.webp
-- So any object that is NOT "<uid>.webp" (i.e. anything containing a "/", the
-- old per-user folder layout) is an orphan and safe to delete — the live
-- player_accounts.avatar_url never points at those anymore.
--
-- HOW TO RUN
--   • Supabase Dashboard → SQL Editor, paste this file, run. OR via MCP
--     execute_sql. Requires a role that can DELETE from storage.objects
--     (service_role / the SQL editor's admin role — NOT anon/authenticated).
--   • Run step 1 (DRY RUN) first and eyeball the list. Then run step 2.
--   • Storage rows deleted here remove the DB record; Supabase's storage layer
--     reconciles the underlying file. For a hard guarantee you can also delete
--     via the Storage API / `supabase storage rm`, but removing the
--     storage.objects row is the supported SQL path.
--
-- SAFETY: this ONLY ever targets bucket_id='avatars' AND objects that are NOT
-- the canonical "<uid>.webp". It can never touch a current avatar or any other
-- bucket (news-images, player-photos, team-logos, tournament-covers, hero-videos).
-- ════════════════════════════════════════════════════════════════════════════

-- ── STEP 1: DRY RUN — list what WOULD be deleted (run this first) ────────────
SELECT
  id,
  name,
  pg_size_pretty(coalesce((metadata->>'size')::bigint, 0)) AS size,
  created_at
FROM storage.objects
WHERE bucket_id = 'avatars'
  AND name !~ '^[0-9a-fA-F-]{36}\.webp$'   -- keep only canonical "<uid>.webp"
ORDER BY created_at;

-- ── STEP 2: DELETE the orphans (uncomment and run after reviewing step 1) ────
-- WITH deleted AS (
--   DELETE FROM storage.objects
--   WHERE bucket_id = 'avatars'
--     AND name !~ '^[0-9a-fA-F-]{36}\.webp$'
--   RETURNING 1
-- )
-- SELECT count(*) AS orphaned_avatars_deleted FROM deleted;

-- ── OPTIONAL STEP 3: also delete a canonical avatar that is no longer
--    referenced by its owner's row (e.g. user cleared their photo). Conservative
--    — only removes "<uid>.webp" when player_accounts.avatar_url for that uid is
--    NULL or doesn't contain the object name.
-- WITH deleted AS (
--   DELETE FROM storage.objects o
--   USING (
--     SELECT o2.id
--     FROM storage.objects o2
--     LEFT JOIN public.player_accounts p
--       ON p.id::text = left(o2.name, 36)              -- "<uid>" prefix of "<uid>.webp"
--     WHERE o2.bucket_id = 'avatars'
--       AND o2.name ~ '^[0-9a-fA-F-]{36}\.webp$'
--       AND (p.avatar_url IS NULL OR position(o2.name in p.avatar_url) = 0)
--   ) stale
--   WHERE o.id = stale.id
--   RETURNING 1
-- )
-- SELECT count(*) AS unreferenced_canonical_deleted FROM deleted;
