export function Footer() {
  return (
    <footer className="arena-footer">
      <div className="arena-footer__inner">
        {/* Logo with tagline beneath, centred as a unit */}
        <div className="arena-footer__brand-block">
          <a href="/" aria-label="Clutch.gg home">
            <img src="/logo.png" alt="Clutch.gg" className="arena-footer__logo" />
          </a>
          <p className="arena-footer__tagline">
            You can't improve what you don't measure.
          </p>
        </div>

        {/* Link columns */}
        <div className="arena-footer__cols">
          <div>
            <p className="arena-footer__col-title">Platform</p>
            <a href="/tournaments" className="arena-footer__link">Tournament</a>
            <a href="/matches" className="arena-footer__link">Matches</a>
            <a href="/teams" className="arena-footer__link">Teams</a>
            <a href="/stats" className="arena-footer__link">Stats</a>
            <a href="/news" className="arena-footer__link">News</a>
          </div>
          <div>
            <p className="arena-footer__col-title">Legal</p>
            <a href="/" className="arena-footer__link">Terms</a>
            <a href="/" className="arena-footer__link">Privacy</a>
          </div>
          <div>
            <p className="arena-footer__col-title">Social</p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <a href="https://www.instagram.com/clutchg.g/" className="arena-footer__link" style={{ marginBottom: 0 }} title="Instagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4c0 3.2-2.6 5.8-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8C2 4.6 4.6 2 7.8 2m-.3 2c-2.1 0-3.8 1.7-3.8 3.8v8.4c0 2.1 1.7 3.8 3.8 3.8h8.4c2.1 0 3.8-1.7 3.8-3.8V7.8c0-2.1-1.7-3.8-3.8-3.8H7.5m9.6 1.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3m-5.1 1.5c-2.5 0-4.5 2-4.5 4.5s2 4.5 4.5 4.5 4.5-2 4.5-4.5-2-4.5-4.5-4.5m0 2c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5-2.5-1.1-2.5-2.5 1.1-2.5 2.5-2.5"/></svg>
              </a>
              <a href="https://x.com/clutchggs" className="arena-footer__link" style={{ marginBottom: 0 }} title="Twitter">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z"/></svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="arena-footer__bottom">
        <span>© 2026 Clutch.gg</span>
        <span>All rights reserved.</span>
      </div>
    </footer>
  );
}
