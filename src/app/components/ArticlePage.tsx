import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Clock, User, ExternalLink, Trophy } from 'lucide-react';
import { Header } from './Header';
import type { NewsItem } from './AdminPanel';
import type { Tournament } from './TournamentCreation';
import { getNews, getTournaments } from '../services/db';
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
  const [article, setArticle] = useState<NewsItem | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getNews(), getTournaments()])
      .then(([items, ts]) => {
        setArticle(items.find(n => n.id === id) ?? null);
        setTournaments(ts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const mentionIndex = useMemo(() => buildMentionIndex(tournaments), [tournaments]);
  const linkedTournament = useMemo(
    () => (article?.tournamentId ? tournaments.find(t => t.id === article.tournamentId) ?? null : null),
    [article, tournaments],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-[#ff4655] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <main className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-gray-400 mb-4">Article not found</p>
          <button onClick={() => navigate('/')} className="text-[#ff4655] text-sm hover:underline">
            Back to home
          </button>
        </main>
      </div>
    );
  }

  const body = article.body ?? [];

  return (
    <div className="min-h-screen bg-[#0d0f16] pb-16">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Back */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm">Back</span>
        </button>

        <article>
          {/* Category */}
          {article.category && (
            <span className="inline-block bg-[#ff4655] text-white text-xs font-semibold px-2 py-1 rounded mb-3">
              {article.category}
            </span>
          )}

          {/* Title */}
          <h1 className="text-white font-bold text-3xl sm:text-4xl leading-tight">{article.title}</h1>

          {/* Byline */}
          <div className="flex items-center gap-4 mt-3 text-gray-500 text-sm">
            {article.author && (
              <span className="flex items-center gap-1.5">
                <User className="w-4 h-4" />
                {article.author}
              </span>
            )}
            {article.timeAgo && (
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                {article.timeAgo}
              </span>
            )}
            {linkedTournament && (
              <Link to="/matches" className="flex items-center gap-1.5 text-[#ff4655] hover:underline">
                <Trophy className="w-4 h-4" />
                {linkedTournament.name}
              </Link>
            )}
          </div>

          {/* Cover image */}
          {article.imageUrl && (
            <div className="mt-6 rounded-xl overflow-hidden border border-[#2a2d3a]">
              <img src={article.imageUrl} alt={article.title} className="w-full object-cover" />
            </div>
          )}

          {/* Body */}
          <div className="mt-8 space-y-5">
            {body.length === 0 ? (
              <p className="text-gray-500 text-sm">No article content.</p>
            ) : (
              body.map(block => {
                if (block.type === 'heading') {
                  return (
                    <h2 key={block.id} className="text-white font-bold text-xl sm:text-2xl mt-8 mb-1">
                      {block.text}
                    </h2>
                  );
                }
                if (block.type === 'paragraph') {
                  return (
                    <p key={block.id} className="text-gray-300 text-base leading-relaxed whitespace-pre-wrap">
                      <MentionedText text={block.text} index={mentionIndex} />
                    </p>
                  );
                }
                // image
                return (
                  <figure key={block.id} className="my-6">
                    <div className="rounded-xl overflow-hidden border border-[#2a2d3a]">
                      <img src={block.url} alt={block.caption || ''} className="w-full object-cover" />
                    </div>
                    {block.caption && (
                      <figcaption className="text-gray-500 text-xs text-center mt-2">{block.caption}</figcaption>
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
        </article>
      </main>
    </div>
  );
}
