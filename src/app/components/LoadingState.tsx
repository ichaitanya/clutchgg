import { useEffect, useState } from 'react';

// Shared loading indicator shown while a page's data is still being fetched.
// Use this (gated on `data === null`, i.e. "not loaded yet") instead of letting
// a page fall through to its empty-state copy ("No tournaments", etc.) — an
// empty list during load reads as "nothing exists" when it's really "still
// loading". `inline` renders just the spinner block (for embedding inside an
// already-rendered page section); the default renders a full centered panel.
//
// If the fetch is still going after `slowAfterMs` (data layer retries on a
// 15s-per-attempt timeout), we swap in a reassuring "taking longer than usual"
// note plus a manual Reload, so a stalled/offline load never looks frozen.
interface LoadingStateProps {
  label?: string;
  inline?: boolean;
  slowAfterMs?: number;
}

export function LoadingState({ label = 'Loading…', inline = false, slowAfterMs = 15_000 }: LoadingStateProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(t);
  }, [slowAfterMs]);

  return (
    <div className={inline ? 'arena-loading arena-loading--inline' : 'arena-loading'}>
      <span className="arena-loading__spinner" aria-hidden="true" />
      <p className="arena-loading__text">{slow ? 'Still loading — taking longer than usual.' : label}</p>
      {slow && (
        <button type="button" className="arena-loading__retry" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
    </div>
  );
}
