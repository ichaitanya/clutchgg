import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Trophy, ArrowRight } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { SharePopover } from './SharePopover';
import type { NewsItem } from './AdminPanel';
import type { Tournament } from './TournamentCreation';
import { getNews, getTournaments, loadWithRetry } from '../services/db';
import { buildMentionIndex, parseMentions } from '../utils/mentions';

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

  useEffect(() => loadWithRetry(
    () => Promise.all([getNews(), getTournaments()]),
    ([items, ts]) => { setNews(items); setTournaments(ts); setLoading(false); },
  ), [id]);

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
            {/* key resets the popup/copied state when flipping between articles */}
            <SharePopover key={id} shareText={article.title} />

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
