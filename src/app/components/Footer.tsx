export function Footer() {
  return (
    <footer className="arena-footer">
      <div className="arena-footer__inner">
        {/* Brand + tagline */}
        <div>
          <div className="arena-footer__brand">CLUTCH.GG</div>
          <p className="arena-footer__tagline">
            Definitive digital environment for<br />
            high-performance competitive rosters.
          </p>
        </div>

        {/* Link columns */}
        <div className="arena-footer__cols">
          <div>
            <p className="arena-footer__col-title">Platform</p>
            <a href="/matches" className="arena-footer__link">Tournaments</a>
            <a href="/matches" className="arena-footer__link">Editorial</a>
            <a href="/stats" className="arena-footer__link">Sync</a>
          </div>
          <div>
            <p className="arena-footer__col-title">Legal</p>
            <a href="/" className="arena-footer__link">Terms</a>
            <a href="/" className="arena-footer__link">Privacy</a>
          </div>
          <div>
            <p className="arena-footer__col-title">Social</p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <a href="/" className="arena-footer__link" style={{ marginBottom: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z"/></svg>
              </a>
              <a href="/" className="arena-footer__link" style={{ marginBottom: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/></svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="arena-footer__bottom">
        <span>© 2025 Clutch.gg</span>
        <span>High-performance infrastructure.</span>
      </div>
    </footer>
  );
}
