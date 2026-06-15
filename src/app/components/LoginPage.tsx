import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { signInWithProvider, type OAuthProvider } from '../services/supabase';
import { useAuth } from '../context/AuthContext';

// Brand marks for the OAuth buttons (inline SVG keeps the bundle tiny and the
// colors exact).
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/>
  </svg>
);

const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2" aria-hidden="true">
    <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

export function LoginPage() {
  const navigate = useNavigate();
  const { userId, loading } = useAuth();
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Already signed in → straight to the profile.
  useEffect(() => {
    if (!loading && userId) navigate('/profile', { replace: true });
  }, [loading, userId, navigate]);

  const handleLogin = async (provider: OAuthProvider) => {
    setError(null);
    setPending(provider);
    try {
      await signInWithProvider(provider);
      // The browser is being redirected to the provider — nothing more to do.
    } catch (e: any) {
      setError(e?.message || 'Could not start sign-in. Please try again.');
      setPending(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
      <Header />

      <main className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="arena-contact__card" style={{ maxWidth: 420 }}>
          <div className="arena-contact__header">
            <h1 className="arena-contact__title">Player Login</h1>
            <p className="arena-contact__sub">
              Sign in to claim your player profile, customize it, and earn your
              Verified badge.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => handleLogin('google')}
              disabled={pending !== null}
              className="arena-btn arena-btn--primary flex items-center justify-center gap-3"
              style={{ width: '100%', padding: '0.9rem 1rem' }}
            >
              <GoogleIcon />
              {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </button>
            <button
              onClick={() => handleLogin('discord')}
              disabled={pending !== null}
              className="arena-btn arena-btn--primary flex items-center justify-center gap-3"
              style={{ width: '100%', padding: '0.9rem 1rem' }}
            >
              <DiscordIcon />
              {pending === 'discord' ? 'Redirecting…' : 'Continue with Discord'}
            </button>
          </div>

          {error && <p className="arena-contact__error" style={{ marginTop: '1rem' }}>{error}</p>}

          <p className="arena-contact__hint" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
            Link both Google and Discord on your profile to become a Verified User.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
