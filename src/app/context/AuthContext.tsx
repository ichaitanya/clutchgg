import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import {
  supabase,
  getStoredSession,
  getPlayerAccount,
  ensurePlayerAccount,
  captureRiotId,
  type PlayerAccount,
} from '../services/supabase';
import { claimReferral } from '../services/pickems';

// ── Referral capture ─────────────────────────────────────────────────────────
// A visitor landing with ?ref=CODE has the code stashed (7-day TTL) so it can be
// applied right after their account is first created — even across the OAuth
// round-trip, which drops query params. Mirrors the clutchgg-claim-intent pattern.
const REF_KEY = 'clutchgg-ref';
const REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function stashReferralFromUrl() {
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (code && /^[a-z0-9]{4,40}$/i.test(code)) {
      localStorage.setItem(REF_KEY, JSON.stringify({ code: code.toLowerCase(), at: Date.now() }));
    }
  } catch { /* ignore */ }
}

function consumeStashedReferral(): string | null {
  try {
    const raw = localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw);
    localStorage.removeItem(REF_KEY);
    if (!code || Date.now() - at > REF_TTL_MS) return null;
    return code as string;
  } catch { return null; }
}

// Site-wide auth state for PLAYER accounts. Staff auth (admin/organizer) keeps
// its own self-contained flow inside AdminPanel — this context is additive and
// read-only from the panel's perspective. A staff session simply yields
// playerAccount === null here (no player_accounts row), so the header shows
// nothing player-specific for admins unless they create a player profile.

interface AuthState {
  userId: string | null;
  /** The player profile row, null when signed out or not yet resolved. */
  playerAccount: PlayerAccount | null;
  /**
   * Set when this OAuth sign-in created a SECOND user for an email that already
   * owns an account (the 007 guard blocked the rival profile). The UI shows a
   * "sign in with your original provider and link this one" recovery screen.
   * Holds the colliding email for that message.
   */
  duplicateEmail: string | null;
  /**
   * True when we resolved a session but failed to load OR create the player
   * account (network/RLS error). Lets the profile page show a retry instead of
   * spinning forever. Never set for the duplicate-email case (that has its own
   * screen).
   */
  accountError: boolean;
  /**
   * One-shot Discord access token captured from the session right after an
   * OAuth round-trip (Supabase delivers it once and never persists it). The
   * claim flow sends it to the verify-riot-claim edge function. Null on
   * ordinary loads.
   */
  providerToken: string | null;
  /** True while the initial session/account resolution is in flight. */
  loading: boolean;
  /**
   * Re-read the player account. Pass `true` to first re-sync the
   * linked-provider flags from auth.identities (after a linkIdentity redirect),
   * since those flags only refresh on a write, not a read.
   */
  refresh: (resync?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  userId: null,
  playerAccount: null,
  duplicateEmail: null,
  accountError: false,
  providerToken: null,
  loading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [playerAccount, setPlayerAccount] = useState<PlayerAccount | null>(null);
  const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);
  const [accountError, setAccountError] = useState(false);
  const [providerToken, setProviderToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The last Discord provider_token we already sent to capture-riot-id. Auth
  // events (SIGNED_IN/USER_UPDATED/TOKEN_REFRESHED) can fire repeatedly with the
  // SAME token — without this guard we'd hammer capture-riot-id in a loop (each
  // capture's loadAccount can re-emit an event), which is what made the admin
  // page crawl. Capture at most once per distinct token.
  const capturedTokenRef = useRef<string | null>(null);

  // `resync` re-runs the identity-flag trigger (via a no-op write inside
  // ensurePlayerAccount) before reflecting the row — needed after returning
  // from a linkIdentity redirect, because the linked flags only update when the
  // row is WRITTEN, not on a plain read. A bare read would show stale
  // google_linked/discord_linked and keep showing "Verify" for an already
  // linked provider.
  const loadAccount = useCallback(async (uid: string, accessToken?: string, resync = false) => {
    if (!resync) {
      const account = await getPlayerAccount(uid, accessToken);
      if (account) {
        setPlayerAccount(account);
        setDuplicateEmail(null);
        setAccountError(false);
        return;
      }
    }
    // Either the row doesn't exist yet (→ create) or we want a forced re-sync
    // (→ ensurePlayerAccount's existing-row path issues the flag-syncing
    // update). Anyone signed in (including staff — a staff member is also a
    // person) may have a player profile; the row is independent of their
    // profiles/role row. The duplicate-email guard (007) still blocks a SECOND
    // account for an email that already owns one.
    const result = await ensurePlayerAccount();
    if (result.status === 'ok') {
      setPlayerAccount(result.account);
      setDuplicateEmail(null);
      setAccountError(false);
      // Brand-new account that came through a referral link → record the
      // referral once (server is a no-op if there's no/invalid stashed code).
      if (result.created) {
        const code = consumeStashedReferral();
        if (code) { claimReferral(code).catch(() => {}); }
      }
    } else if (result.status === 'duplicate_email') {
      setPlayerAccount(null);
      setDuplicateEmail(result.email ?? 'your email');
      setAccountError(false);
    } else {
      setPlayerAccount(null);
      setDuplicateEmail(null);
      setAccountError(true);
    }
  }, []);

  // refresh(true) forces a re-sync of the linked-provider flags from
  // auth.identities (use after a linkIdentity round-trip). refresh() alone just
  // re-reads the row.
  const refresh = useCallback(async (resync = false) => {
    const stored = getStoredSession();
    if (!stored || stored.accessTokenExpired) {
      // Expired access token still might refresh in the background via the
      // auth client; onAuthStateChange will catch that. For now reflect what
      // we can prove without network.
      if (!stored) {
        setUserId(null);
        setPlayerAccount(null);
        setDuplicateEmail(null);
        setAccountError(false);
      }
      return;
    }
    setUserId(stored.user.id);
    await loadAccount(stored.user.id, stored.access_token, resync);
  }, [loadAccount]);

  useEffect(() => {
    let cancelled = false;

    // Capture a ?ref=CODE before anything else so it survives the OAuth round-trip.
    stashReferralFromUrl();

    // Seed synchronously from localStorage (lock-free — see getStoredSession)
    // so the header doesn't flash "Login" for an already-signed-in user.
    const stored = getStoredSession();
    if (stored && !stored.accessTokenExpired) {
      setUserId(stored.user.id);
      // The OAuth provider token survives in the persisted session until the
      // next refresh — seed it here in case detectSessionInUrl consumed the
      // redirect hash before this subscription existed.
      if (stored.provider_token) setProviderToken(stored.provider_token);
      loadAccount(stored.user.id, stored.access_token).finally(() => {
        if (!cancelled) setLoading(false);
      });
    } else {
      setLoading(false);
    }

    // React to OAuth redirects (SIGNED_IN fires when detectSessionInUrl
    // consumes the /auth/callback hash), identity links (USER_UPDATED), and
    // sign-outs.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT') {
        setUserId(null);
        setPlayerAccount(null);
        setDuplicateEmail(null);
        setAccountError(false);
        setProviderToken(null);
        return;
      }
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') && session?.user) {
        setUserId(session.user.id);
        // Grab the one-shot OAuth provider token the moment it appears — the
        // claim flow needs it and it is NOT delivered again on later events.
        if (session.provider_token) setProviderToken(session.provider_token);
        // After an OAuth round-trip that carries a provider_token, try to capture
        // the user's verified Riot connection in the background so the "this
        // could be your profile" match can run.
        //
        // We gate on Discord being a LINKED provider (app_metadata.providers),
        // NOT the primary provider (app_metadata.provider) — for a Google-primary
        // user who linked Discord, `provider` stays "google" after a Discord
        // re-auth, so an `=== 'discord'` gate would never fire (this was the bug:
        // capture-riot-id was never called for Google-primary accounts). A Google
        // provider_token is harmless here: capture-riot-id validates the token
        // against Discord's /users/@me and returns bad_token (without clearing
        // anything) if it isn't a Discord bearer.
        const providers: string[] = (session.user.app_metadata as any)?.providers ?? [];
        if (
          session.provider_token &&
          providers.includes('discord') &&
          capturedTokenRef.current !== session.provider_token // once per token
        ) {
          const token = session.provider_token;
          capturedTokenRef.current = token;
          setTimeout(() => {
            captureRiotId(token).finally(() => {
              // Re-read the account so the refreshed riot_connection_verified
              // lands in context (drives the connect-Riot nudge / suggestions).
              if (!cancelled) loadAccount(session.user.id, session.access_token);
            });
          }, 0);
        }
        // Defer the DB read out of the auth callback (GoTrue holds its lock
        // while listeners run — a query through the auth client would deadlock).
        setTimeout(() => {
          if (!cancelled) loadAccount(session.user.id, session.access_token);
        }, 0);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadAccount]);

  return (
    <AuthContext.Provider value={{ userId, playerAccount, duplicateEmail, accountError, providerToken, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
