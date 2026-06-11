import { useEffect, useRef, useState } from 'react';
import { Share2, Check, Link2, Instagram, MessageCircle } from 'lucide-react';

// X (Twitter) glyph — lucide has no dedicated X icon.
function XGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

interface SharePopoverProps {
  /** Text accompanying the link on X/WhatsApp (e.g. article or match title). */
  shareText: string;
  /** Trigger styling; defaults to the article page's square icon button. */
  buttonClassName?: string;
  /** Optional visible label inside the trigger (icon-only when omitted). */
  label?: string;
  /** Open the popup below the trigger instead of above (default 'up'). */
  direction?: 'up' | 'down';
  /** Align the popup to the trigger's left or right edge (default 'left'). */
  align?: 'left' | 'right';
}

// In-page share popup: copy link, X, Instagram (copies link + opens IG since it
// has no web share URL), WhatsApp. Shares the current page URL.
export function SharePopover({
  shareText,
  buttonClassName = 'arena-article__share-btn',
  label,
  direction = 'up',
  align = 'left',
}: SharePopoverProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the popup on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  const openPopup = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=520');
    setOpen(false);
  };
  const flashCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToX = () =>
    openPopup(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`);
  // Instagram has no web Story-share URL. Copy the link so it can be pasted into
  // a story, and open Instagram in a new tab.
  const shareToInstagram = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      flashCopied();
    } catch { /* ignore */ }
    openPopup('https://www.instagram.com/');
  };
  const shareToWhatsApp = () =>
    openPopup(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      flashCopied();
    } catch { /* ignore */ }
    setOpen(false);
  };

  return (
    <div className="arena-article__share" ref={ref}>
      <button
        className={buttonClassName}
        onClick={() => setOpen(o => !o)}
        aria-label="Share"
        title="Share"
        aria-expanded={open}
      >
        {copied ? <Check className="w-4 h-4 text-[#ff4655]" /> : <Share2 className="w-4 h-4" />}
        {label && <span>{copied ? 'Copied' : label}</span>}
      </button>
      {copied && !label && <span className="arena-article__share-copied">Link copied</span>}

      {open && (
        <div
          className={`arena-share-pop${direction === 'down' ? ' arena-share-pop--down' : ''}${align === 'right' ? ' arena-share-pop--right' : ''}`}
          role="menu"
        >
          <p className="arena-share-pop__title">Share</p>
          <div className="arena-share-pop__grid">
            <button className="arena-share-pop__item" onClick={copyLink}>
              <span className="arena-share-pop__icon"><Link2 className="w-5 h-5" /></span>
              Copy link
            </button>
            <button className="arena-share-pop__item" onClick={shareToX}>
              <span className="arena-share-pop__icon"><XGlyph className="w-5 h-5" /></span>
              X
            </button>
            <button className="arena-share-pop__item" onClick={shareToInstagram}>
              <span className="arena-share-pop__icon"><Instagram className="w-5 h-5" /></span>
              Instagram
            </button>
            <button className="arena-share-pop__item" onClick={shareToWhatsApp}>
              <span className="arena-share-pop__icon"><MessageCircle className="w-5 h-5" /></span>
              WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
