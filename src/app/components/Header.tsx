import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, LogOut, Menu, User, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { signOut } from '../services/supabase';

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { playerAccount } = useAuth();
  const userMenuRef = useRef<HTMLLIElement>(null);

  const linkClass = (path: string) =>
    `arena-nav__link${pathname === path || (path !== '/' && pathname.startsWith(path)) ? ' arena-nav__link--active' : ''}`;

  // Close the avatar dropdown on any outside click.
  useEffect(() => {
    if (!userMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [userMenuOpen]);

  const handleSignOut = async () => {
    setUserMenuOpen(false);
    setMenuOpen(false);
    await signOut();
    navigate('/', { replace: true });
    // signOut purges the token synchronously but the context's SIGNED_OUT
    // event is fire-and-forget — reload guarantees every component resets.
    window.location.reload();
  };

  // Small round avatar used in both the desktop pill and the mobile rows.
  const AvatarDot = ({ size = 28 }: { size?: number }) =>
    playerAccount ? (
      <span
        className="inline-flex items-center justify-center overflow-hidden shrink-0"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px solid var(--arena-accent)',
          background: '#1c1b1b',
        }}
      >
        {playerAccount.avatar_url ? (
          <img
            src={playerAccount.avatar_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ color: 'var(--arena-text-muted)', fontSize: size * 0.38, fontWeight: 700 }}>
            {playerAccount.display_name.trim().slice(0, 2).toUpperCase()}
          </span>
        )}
      </span>
    ) : null;

  return (
    <nav className="arena-nav" style={{ position: 'relative' }}>
      <div className="arena-nav__inner">
        {/* Brand — left. On the home page show the logo BESIDE the wordmark;
            on every other page show only the logo, larger, still linking home. */}
        <a href="/" className="arena-nav__brand" aria-label="Clutch.gg home">
          <img
            src="/logo.png"
            alt="Clutch.gg"
            className={`arena-nav__logo${pathname === '/' ? '' : ' arena-nav__logo--lg'}`}
          />
          {pathname === '/' && <span className="arena-nav__brand-text">CLUTCH.GG</span>}
        </a>

        {/* Desktop nav links — right-aligned, original site names.
            Hidden below the mobile breakpoint via .arena-nav__links itself. */}
        <ul className="arena-nav__links">
          <li><a href="/tournaments" className={linkClass('/tournaments')}>Tournaments</a></li>
          <li><a href="/matches" className={linkClass('/matches')}>Matches</a></li>
          <li><a href="/teams" className={linkClass('/teams')}>Teams</a></li>
          <li><a href="/stats" className={linkClass('/stats')}>Stats</a></li>
          <li><a href="/news" className={linkClass('/news')}>News</a></li>
          {playerAccount ? (
            <li ref={userMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                aria-label="Account menu"
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <AvatarDot />
                {playerAccount.is_verified && (
                  <BadgeCheck className="w-4 h-4" style={{ color: 'var(--arena-accent)' }} />
                )}
              </button>
              {userMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 12px)',
                    right: 0,
                    minWidth: 180,
                    background: 'var(--arena-nav-bg)',
                    border: '1px solid var(--arena-nav-border)',
                    zIndex: 60,
                  }}
                >
                  <a
                    href="/profile"
                    className="arena-nav__link flex items-center gap-2"
                    style={{ display: 'flex', padding: '0.8rem 1rem' }}
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <User className="w-4 h-4" /> My Profile
                  </a>
                  <button
                    onClick={handleSignOut}
                    className="arena-nav__link flex items-center gap-2"
                    style={{
                      display: 'flex',
                      padding: '0.8rem 1rem',
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              )}
            </li>
          ) : (
            <li><a href="/login" className={linkClass('/login')}>Login</a></li>
          )}
        </ul>

        {/* Mobile hamburger — shown only below the mobile breakpoint */}
        <button
          className="arena-nav__burger"
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="arena-nav__mobile">
          <ul className="arena-nav__mobile-list">
            <li><a href="/tournaments" className={linkClass('/tournaments')} onClick={() => setMenuOpen(false)}>Tournaments</a></li>
            <li><a href="/matches" className={linkClass('/matches')} onClick={() => setMenuOpen(false)}>Matches</a></li>
            <li><a href="/teams" className={linkClass('/teams')} onClick={() => setMenuOpen(false)}>Teams</a></li>
            <li><a href="/stats" className={linkClass('/stats')} onClick={() => setMenuOpen(false)}>Stats</a></li>
            <li><a href="/news" className={linkClass('/news')} onClick={() => setMenuOpen(false)}>News</a></li>
            {playerAccount ? (
              <>
                <li>
                  <a
                    href="/profile"
                    className={linkClass('/profile')}
                    onClick={() => setMenuOpen(false)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}
                  >
                    <AvatarDot size={24} />
                    My Profile
                    {playerAccount.is_verified && (
                      <BadgeCheck className="w-4 h-4" style={{ color: 'var(--arena-accent)' }} />
                    )}
                  </a>
                </li>
                <li>
                  <a
                    href="/"
                    onClick={e => { e.preventDefault(); handleSignOut(); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </a>
                </li>
              </>
            ) : (
              <li><a href="/login" className={linkClass('/login')} onClick={() => setMenuOpen(false)}>Login</a></li>
            )}
          </ul>
        </div>
      )}
    </nav>
  );
}
