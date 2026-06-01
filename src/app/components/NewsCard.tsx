import { Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface NewsCardProps {
  title: string;
  category: string;
  timeAgo: string;
  imageUrl: string;
  link?: string;
  // Internal article id. When provided (and no external link), the card opens
  // the in-app article page; an external link takes precedence if set.
  id?: string;
}

export function NewsCard({ title, category, timeAgo, imageUrl, link, id }: NewsCardProps) {
  const navigate = useNavigate();

  const clickable = !!link || !!id;
  const handleClick = () => {
    if (link) {
      window.open(link, '_blank');
    } else if (id) {
      navigate(`/news/${id}`);
    }
  };

  return (
    <div 
      onClick={handleClick}
      className={`bg-[#1e2130] border border-[#2a2d3a] rounded-lg overflow-hidden hover:border-[#ff4655]/50 transition-colors ${
        clickable ? 'cursor-pointer' : ''
      } group`}
    >
      <div className="aspect-video overflow-hidden relative">
        <ImageWithFallback
          src={imageUrl}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute top-3 left-3">
          <span className="bg-[#ff4655] text-white text-xs font-semibold px-2 py-1 rounded">
            {category}
          </span>
        </div>
      </div>

      <div className="p-4">
        <h4 className="text-white font-semibold mb-2 line-clamp-2 group-hover:text-[#ff4655] transition-colors">
          {title}
        </h4>
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <Clock className="w-3 h-3" />
          <span>{timeAgo}</span>
        </div>
      </div>
    </div>
  );
}
