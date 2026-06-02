import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Newspaper } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { ImageWithFallback } from './figma/ImageWithFallback';
import type { AdminData, NewsItem } from './AdminPanel';
import { loadAdminData } from '../services/db';

// First paragraph of an article body, cleaned of mention/markdown syntax.
function excerptOf(n: NewsItem): string {
  const para = n.body?.find(b => b.type === 'paragraph' && b.text);
  if (!para?.text) return '';
  return para.text
    .replace(/@\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]/g, '')
    .trim();
}

function ArticleCard({ item }: { item: NewsItem }) {
  const navigate = useNavigate();
  const meta = [item.category, item.timeAgo].filter(Boolean).join(' • ');
  const excerpt = excerptOf(item);

  const onClick = () => {
    if (item.link) window.open(item.link, '_blank');
    else navigate(`/news/${item.id}`);
  };

  return (
    <article onClick={onClick} className="arena-news-card">
      <div className="arena-news-card__thumbnail">
        {item.imageUrl
          ? <ImageWithFallback src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
          : <Newspaper className="w-9 h-9 text-white" />}
      </div>
      <div className="arena-news-card__body">
        <p className="arena-news-card__meta">{meta}</p>
        <h3 className="arena-news-card__title arena-news-card__title--serif">{item.title}</h3>
        {excerpt && <p className="arena-news-card__excerpt">{excerpt}</p>}
      </div>
    </article>
  );
}

export function NewsPage() {
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    loadAdminData().then(setAdminData).catch(() => {});
  }, []);

  const articles = (adminData?.news ?? []).filter(n => n.visible);

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      {/* Centered hero */}
      <section className="arena-page-hero">
        <p className="arena-page-hero__eyebrow">Editorial</p>
        <h1 className="arena-page-hero__title">The Latest from the Arena.</h1>
        <p className="arena-page-hero__subtitle">
          Match recaps, roster intel, and high-performance analysis from across
          the competitive circuit.
        </p>
      </section>

      <div className="arena-page" style={{ paddingBottom: '5rem' }}>
        {articles.length > 0 ? (
          <div className="arena-news-grid">
            {articles.map(n => <ArticleCard key={n.id} item={n} />)}
          </div>
        ) : (
          <div className="text-center py-16 text-gray-500 text-sm border-t border-[#2b2b2b]">
            No articles published yet
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
