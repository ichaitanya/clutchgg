# Player Login — Supabase Dashboard Setup

These are the **manual dashboard steps** that the player OAuth login feature
depends on. They are NOT in code (Supabase doesn't expose them via migrations),
so they must be re-applied by hand if the project is ever recreated or restored
into a new Supabase project. The database side (tables, triggers, RLS, buckets)
is in `migrations/006_player_accounts.sql` and `migrations/007_prevent_duplicate_player_email.sql`.

Project ref: `atjongzdifyjnzkbqyoc`
Supabase auth callback URL (providers point here): `https://atjongzdifyjnzkbqyoc.supabase.co/auth/v1/callback`

---

## 1. Enable the OAuth providers
**Dashboard → Authentication → Sign In / Providers**

### Google
- [ ] Create an OAuth client in Google Cloud Console
      (APIs & Services → Credentials → OAuth client ID → *Web application*).
- [ ] Authorized redirect URI: `https://atjongzdifyjnzkbqyoc.supabase.co/auth/v1/callback`
- [ ] Paste the **Client ID** and **Client Secret** into Supabase → Google provider → enable.

### Discord
- [ ] In the Discord Developer Portal app (OAuth2 → Redirects), add:
      `https://atjongzdifyjnzkbqyoc.supabase.co/auth/v1/callback`
- [ ] Copy the **Client ID** and **Client Secret** into Supabase → Discord provider → enable.
- [ ] ⚠️ The secret used during early testing (`_9DjMb-…`) was pasted in plaintext —
      **Reset Secret** in Discord and use the new value here.
- Scopes requested by the app: `identify email` for login; the profile-claim
      re-auth additionally requests `connections` (to read the Discord-verified
      Riot ID).

---

## 2. Allow manual identity linking  ← REQUIRED for the Verify buttons
**Dashboard → Authentication → Settings (or "Auth Providers" → bottom)**

- [ ] Enable **"Allow manual linking"**.
      Without this, `supabase.auth.linkIdentity()` errors and the
      "Verify Discord" / "Verify Google" buttons on `/profile` do nothing.

---

## 3. Email confirmation (account-duplication defense)
**Dashboard → Authentication → Settings**

- [ ] Keep **"Confirm email" ON**. With confirmed emails, GoTrue links a second
      provider into the SAME user when the email matches, instead of minting a
      duplicate. This works WITH migration 007's case-insensitive guard trigger
      (which also catches the case-variant gap GoTrue's own unique index misses).
- The desired user behavior is: **sign in with the original provider, then LINK
  the second from `/profile`** — never "log in again with the other provider".
  The `/profile` recovery screen tells blocked users exactly this.

---

## 4. Redirect URL allowlist
**Dashboard → Authentication → URL Configuration**

Add every origin the app redirects back to after OAuth (login lands on
`/auth/callback`, identity-link lands on `/profile?linked=1`):

- [ ] `http://localhost:5173/auth/callback`
- [ ] `http://localhost:5173/profile`
- [ ] `https://<PRODUCTION_DOMAIN>/auth/callback`
- [ ] `https://<PRODUCTION_DOMAIN>/profile`
- [ ] (if Vercel preview deploys are used) the preview wildcard, e.g.
      `https://*-<team>.vercel.app/auth/callback`

If a redirect URL is missing from this list, OAuth fails **silently** (the user
is bounced back without a session). Replace `<PRODUCTION_DOMAIN>` with the real
domain before launch.

---

## 5. Profile-claim edge secret  ← REQUIRED to harden the claim flow
**Dashboard → Edge Functions → Manage secrets** (or `supabase secrets set`)

- [ ] Set **`DISCORD_CLIENT_ID`** = your Discord application's Client ID
      (the same Client ID from §1 → Discord).

Why this matters: `verify-riot-claim` always checks that the Discord
provider-token belongs to the **caller's** Discord user. When `DISCORD_CLIENT_ID`
is set, it *additionally* verifies (via `/oauth2/@me`) that the token was minted
for **our** application. Without it, a `connections`-scoped token from **any**
Discord app the user authorized would pass — a meaningfully weaker binding. The
function logs a loud `console.warn` on every invocation while this secret is
unset, so check the edge logs to confirm it's configured.

```
supabase secrets set DISCORD_CLIENT_ID=<your-discord-client-id>
```

---

## 6. (Recommended) Leaked-password protection
**Dashboard → Authentication → Password security**

- [ ] Enable HaveIBeenPwned check. Flagged by the security advisor; applies to
      the staff email/password logins too. (Tracked in the
      `security-fixes-pending-vercel` notes.)

---

## Quick smoke test after configuring
1. `npm run dev`, open `/login`.
2. Google sign-in → redirected to `/profile`, a `player_accounts` row exists,
   `google_linked = true`, no badge yet.
3. On `/profile`, click **Verify Discord** → round-trips → badge appears,
   `discord_linked = true`, `discord_id` populated.
4. Sign out, sign in with Discord on a *fresh* account whose email matches an
   existing user → you should see the **"Account already exists"** recovery
   screen, not a second profile.
5. Confirm admin email/password login at `/admin` still works.
