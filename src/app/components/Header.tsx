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
        {/* Brand wordmark — left */}
        <a href="/" className="arena-nav__brand">CLUTCH.GG</a>

        {/* Desktop nav links — right-aligned, original site names */}
        <ul className="arena-nav__links hidden md:flex">
          <li><a href="/tournaments" className={linkClass('/tournaments')}>Tournaments</a></li>
          <li><a href="/matches" className={linkClass('/matches')}>Matches</a></li>
          <li><a href="/teams" className={linkClass('/teams')}>Teams</a></li>
          <li><a href="/stats" className={linkClass('/stats')}>Stats</a></li>
          <li><a href="/news" className={linkClass('/news')}>News</a></li>
        </ul>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-[#efeeed] hover:text-white"
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div
          className="md:hidden"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            background: '#1a1d29', borderBottom: '1px solid #2a2d3a', zIndex: 50,
          }}
        >
          <ul className="flex flex-col px-6 py-4 gap-4" style={{ listStyle: 'none', margin: 0, padding: '1rem 1.5rem' }}>
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
