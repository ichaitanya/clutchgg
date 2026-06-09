import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  const linkClass = (path: string) =>
    `arena-nav__link${pathname === path || (path !== '/' && pathname.startsWith(path)) ? ' arena-nav__link--active' : ''}`;

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
          </ul>
        </div>
      )}
    </nav>
  );
}
