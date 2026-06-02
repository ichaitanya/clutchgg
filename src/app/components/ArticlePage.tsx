import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Trophy, Share2, Check, ArrowRight, Link2, Instagram, MessageCircle } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { NewsItem } from './AdminPanel';
import type { Tournament } from './TournamentCreation';
import { getNews, getTournaments } from '../services/db';
import { buildMentionIndex, parseMentions } from '../utils/mentions';

// X (Twitter) glyph — lucide has no dedicated X icon.
function XGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

// Render a paragraph string, turning team/player mentions into links.
function MentionedText({ text, index }: { text: string; index: ReturnType<typeof buildMentionIndex> }) {
  const segments = useMemo(() => parseMentions(text, index), [text, index]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'link' ? (
          <Link key={i} to={seg.href} className="text-[#ff4655] hover:underline font-medium">
            {seg.text}
          </Link>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function ArticlePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([getNews(), getTournaments()])
      .then(([items, ts]) => {
        setNews(items);
        setTournaments(ts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Reset transient state when navigating between articles.
  useEffect(() => { setCopied(false); setShareOpen(false); }, [id]);

  // Close the share popup on outside-click / Escape.
  useEffect(() => {
    if (!shareOpen) return;
    const onDown = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShareOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [shareOpen]);

  const visible = useMemo(() => news.filter(n => n.visible), [news]);
  const article = useMemo(() => visible.find(n => n.id === id) ?? null, [visible, id]);

  // Next article = the following entry in the (newest-first) visible list.
  const nextArticle = useMemo(() => {
    const i = visible.findIndex(n => n.id === id);
    if (i === -1) return null;
    return visible[i + 1] ?? null;
  }, [visible, id]);

  const mentionIndex = useMemo(() => buildMentionIndex(tournaments), [tournaments]);
  const linkedTournament = useMemo(
    () => (article?.tournamentId ? tournaments.find(t => t.id === article.tournamentId) ?? null : null),
    [article, tournaments],
  );

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareText = article?.title ?? '';

  const openPopup = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=520');
    setShareOpen(false);
  };

  const shareToX = () =>
    openPopup(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`);
  // Instagram has no web Story-share URL. Copy the link so it can be pasted into
  // a story, and open Instagram in a new tab.
  const shareToInstagram = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
    openPopup('https://www.instagram.com/');
  };
  const shareToWhatsApp = () =>
    openPopup(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
    setShareOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-[#ff4655] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <main className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-gray-400 mb-4">Article not found</p>
          <button onClick={() => navigate('/news')} className="text-[#ff4655] text-sm hover:underline">
            Back to news
          </button>
        </main>
      </div>
    );
  }

  const body = article.body ?? [];

  // Split body so the very first paragraph can carry a drop-cap.
  const firstParaIdx = body.findIndex(b => b.type === 'paragraph');

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-article">
        {/* Back */}
        <button onClick={() => navigate('/news')} className="arena-article__back">
          <ChevronLeft className="w-4 h-4" />
          <span>Back to News</span>
        </button>

        <article>
          {/* Category eyebrow */}
          {article.category && (
            <p className="arena-article__eyebrow">{article.category}</p>
          )}

          {/* Title */}
          <h1 className="arena-article__title">{article.title}</h1>

          {/* Byline */}
          <div className="arena-article__byline">
            {article.author && <span>By {article.author}</span>}
            {article.author && article.timeAgo && <span className="arena-article__byline-sep">/</span>}
            {article.timeAgo && <span>{article.timeAgo}</span>}
            {linkedTournament && (
              <>
                <span className="arena-article__byline-sep">/</span>
                <Link to={`/tournament/${linkedTournament.id}`} className="arena-article__byline-link">
                  <Trophy className="w-3.5 h-3.5" />
                  {linkedTournament.name}
                </Link>
              </>
            )}
          </div>

          {/* Cover image */}
          {article.imageUrl && (
            <div className="arena-article__cover">
              <img src={article.imageUrl} alt={article.title} />
            </div>
          )}

          {/* Body */}
          <div className="arena-article__body">
            {body.length === 0 ? (
              <p className="arena-article__para">No article content.</p>
            ) : (
              body.map((block, i) => {
                if (block.type === 'heading') {
                  return (
                    <h2 key={block.id} className="arena-article__heading">
                      {block.text}
                    </h2>
                  );
                }
                if (block.type === 'paragraph') {
                  return (
                    <p
                      key={block.id}
                      className={`arena-article__para${i === firstParaIdx ? ' arena-article__para--lead' : ''}`}
                    >
                      <MentionedText text={block.text} index={mentionIndex} />
                    </p>
                  );
                }
                // image
                return (
                  <figure key={block.id} className="arena-article__figure">
                    <div className="arena-article__figure-frame">
                      <img src={block.url} alt={block.caption || ''} />
                    </div>
                    {block.caption && (
                      <figcaption className="arena-article__caption">{block.caption}</figcaption>
                    )}
                  </figure>
                );
              })
            )}
          </div>

          {/* External link (read more) */}
          {article.link && (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-8 text-[#ff4655] text-sm font-semibold hover:underline"
            >
              <ExternalLink className="w-4 h-4" /> Read more
            </a>
          )}

          {/* Footer rail: share + next article */}
          <div className="arena-article__rail">
            <div className="arena-article__share" ref={shareRef}>
              <button
                className="arena-article__share-btn"
                onClick={() => setShareOpen(o => !o)}
                aria-label="Share"
                title="Share"
                aria-expanded={shareOpen}
              >
                {copied ? <Check className="w-4 h-4 text-[#ff4655]" /> : <Share2 className="w-4 h-4" />}
              </button>
              {copied && <span className="arena-article__share-copied">Link copied</span>}

              {shareOpen && (
                <div className="arena-share-pop" role="menu">
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

            {nextArticle && (
              <Link to={`/news/${nextArticle.id}`} className="arena-article__next">
                Next Article
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
