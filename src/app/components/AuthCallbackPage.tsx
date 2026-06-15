import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Header } from './Header';
import { LoadingState } from './LoadingState';
import { supabase, readClaimIntent } from '../services/supabase';

// Landing route for OAuth redirects. The tokens arrive in the URL hash and the
// auth client's detectSessionInUrl consumes them in the background — this page
// just shows a spinner until SIGNED_IN fires, then forwards.
//
// Claim flow: a profile-claim re-auth returns here with ?claim=1 and a stashed
// claim intent. We forward to that player card (NOT /profile) carrying ?claim=1,
// so ClaimControls' resume effect picks up the fresh provider_token and submits.
// We do NOT clear the intent here — ClaimControls consumes it.
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState<string | null>(null);

  // Where to send the user once signed in. Default /profile; for a claim return,
  // the player card so the claim resumes.
  const forwardTarget = (): string => {
    const isClaim = new URLSearchParams(window.location.search).has('claim');
    if (isClaim) {
      const intent = readClaimIntent();
      if (intent?.tournamentId && intent?.playerId) {
        return `/player/${intent.tournamentId}/${intent.playerId}?claim=1`;
      }
    }
    return '/profile';
  };

  useEffect(() => {
    // Provider sent back an explicit error (user denied consent, etc.).
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const providerError = hashParams.get('error_description') || hashParams.get('error');
    if (providerError) {
      setFailed(providerError.replace(/\+/g, ' '));
      return;
    }

    let done = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (done) return;
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') && session) {
        done = true;
        navigate(forwardTarget(), { replace: true });
      }
    });

    // The hash may already have been consumed before this effect subscribed
    // (fast paths). Check for an existing session shortly after mount.
    const quickCheck = setTimeout(async () => {
      if (done) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        done = true;
        navigate(forwardTarget(), { replace: true });
      }
    }, 800);

    // Give the token exchange a generous window before declaring failure.
    const giveUp = setTimeout(() => {
      if (!done) setFailed('Sign-in timed out. Please try again.');
    }, 12_000);

    return () => {
      done = true;
      sub.subscription.unsubscribe();
      clearTimeout(quickCheck);
      clearTimeout(giveUp);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        {failed ? (
          <div className="arena-contact__card" style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 className="arena-contact__title">Sign-in failed</h1>
            <p className="arena-contact__sub" style={{ marginTop: '0.75rem' }}>{failed}</p>
            <Link
              to="/login"
              className="arena-btn arena-btn--primary"
              style={{ display: 'inline-block', marginTop: '1.5rem' }}
            >
              Back to Login
            </Link>
          </div>
        ) : (
          <LoadingState label="Signing you in…" inline />
        )}
      </main>
    </div>
  );
}
