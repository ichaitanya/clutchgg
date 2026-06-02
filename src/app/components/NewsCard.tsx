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
    <article
      onClick={handleClick}
      className={`flex flex-col gap-6 group ${clickable ? 'cursor-pointer' : ''}`}
    >
      <div className="aspect-video bg-[#111] border border-[#2b2b2b] overflow-hidden flex items-center justify-center">
        {imageUrl ? (
          <ImageWithFallback
            src={imageUrl}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <Newspaper className="w-9 h-9 text-white" />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[#ff4655] text-[10px] font-inter">{meta}</p>
        <h3 className="text-white text-xl font-chivo leading-snug group-hover:text-[#ff4655] transition-colors">
          {title}
        </h3>
        {excerpt && (
          <p className="text-[#efeeed] text-sm font-inter line-clamp-2">{excerpt}</p>
        )}
      </div>
    </article>
  );
}
