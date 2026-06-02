import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="arena-nav" style={{ position: 'relative' }}>
      <div className="arena-nav__inner">
        {/* Brand wordmark — left */}
        <a href="/" className="arena-nav__brand">CLUTCH.GG</a>

        {/* Desktop nav links — right-aligned, original site names */}
        <ul className="arena-nav__links hidden md:flex">
          <li><a href="/tournaments" className="arena-nav__link">Tournaments</a></li>
          <li><a href="/matches" className="arena-nav__link">Matches</a></li>
          <li><a href="/teams" className="arena-nav__link">Teams</a></li>
          <li><a href="/stats" className="arena-nav__link">Stats</a></li>
          <li><a href="/news" className="arena-nav__link">News</a></li>
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
            <li><a href="/tournaments" className="arena-nav__link" onClick={() => setMenuOpen(false)}>Tournaments</a></li>
            <li><a href="/matches" className="arena-nav__link" onClick={() => setMenuOpen(false)}>Matches</a></li>
            <li><a href="/teams" className="arena-nav__link" onClick={() => setMenuOpen(false)}>Teams</a></li>
            <li><a href="/stats" className="arena-nav__link" onClick={() => setMenuOpen(false)}>Stats</a></li>
            <li><a href="/news" className="arena-nav__link" onClick={() => setMenuOpen(false)}>News</a></li>
          </ul>
        </div>
      )}
    </nav>
  );
}
