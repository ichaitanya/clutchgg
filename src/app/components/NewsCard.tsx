import { useNavigate } from 'react-router-dom';
import { Newspaper } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface NewsCardProps {
  title: string;
  category: string;
  timeAgo: string;
  imageUrl: string;
  link?: string;
  // Optional short excerpt shown under the title (Editorial style).
  excerpt?: string;
  // Internal article id. When provided (and no external link), the card opens
  // the in-app article page; an external link takes precedence if set.
  id?: string;
}

export function NewsCard({ title, category, timeAgo, imageUrl, link, excerpt, id }: NewsCardProps) {
  const navigate = useNavigate();

  const clickable = !!link || !!id;
  const handleClick = () => {
    if (link) {
      window.open(link, '_blank');
    } else if (id) {
      navigate(`/news/${id}`);
    }
  };

  const meta = [category, timeAgo].filter(Boolean).join(' • ');

  return (
    <article onClick={handleClick} className={`arena-news-card ${clickable ? '' : 'cursor-default'}`}>
      <div className="arena-news-card__thumbnail">
        {imageUrl ? (
          <ImageWithFallback src={imageUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <Newspaper className="w-9 h-9 text-white" />
        )}
      </div>

      <div className="arena-news-card__body">
        <p className="arena-news-card__meta">{meta}</p>
        <h3 className="arena-news-card__title">{title}</h3>
        {excerpt && <p className="arena-news-card__excerpt">{excerpt}</p>}
      </div>
    </article>
  );
}
