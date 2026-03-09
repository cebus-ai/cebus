import { ExternalLink, Headphones } from 'lucide-react';

interface MediaItem {
  type?: string;
  title?: string;
  url?: string;
  channel?: string;
  description?: string;
}

interface MediaData {
  items?: MediaItem[];
}

/** Block dangerous URL protocols (javascript:, vbscript:, data:). */
function isSafeUrl(url: string | undefined): boolean {
  if (url === undefined || url.length === 0) return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:') || trimmed.startsWith('data:')) {
    return false;
  }
  return true;
}

/** Extract YouTube video ID from various URL formats. */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {
    // not a valid URL
  }
  return null;
}

export default function MediaBlock({ data }: { data: unknown }) {
  const d = data as MediaData;
  const items = d.items ?? [];

  if (items.length === 0) return null;

  return (
    <div className="my-2 space-y-3 text-start">
      {items.map((item, i) => {
        const isYouTube = item.type === 'youtube';
        const videoId = isYouTube && item.url ? extractYouTubeId(item.url) : null;

        if (isYouTube && videoId && isSafeUrl(item.url)) {
          return (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex gap-3 overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900 transition-colors hover:border-zinc-600 hover:bg-zinc-800/80"
            >
              {/* YouTube thumbnail */}
              <div className="relative h-20 w-32 shrink-0 overflow-hidden bg-black">
                <img
                  src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                  alt={item.title ?? 'YouTube video'}
                  className="h-full w-full object-cover"
                />
                {/* Play button overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/10">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 shadow-lg">
                    <svg viewBox="0 0 24 24" fill="white" className="ms-0.5 h-4 w-4">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </div>
              {/* Title + channel */}
              <div className="flex min-w-0 flex-1 flex-col justify-center py-2 pe-3">
                <div className="flex items-center gap-1.5">
                  <span className="line-clamp-2 text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
                    {item.title ?? 'YouTube Video'}
                  </span>
                  <ExternalLink size={10} className="shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                </div>
                {item.channel && (
                  <span className="mt-0.5 truncate text-xs text-zinc-500">{item.channel}</span>
                )}
                {item.description && (
                  <span className="mt-0.5 line-clamp-1 text-xs text-zinc-600">{item.description}</span>
                )}
              </div>
            </a>
          );
        }

        // Podcast / non-YouTube: clickable card with link
        if (!isSafeUrl(item.url)) return null;
        return (
          <a
            key={i}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex gap-3 overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900 transition-colors hover:border-zinc-600 hover:bg-zinc-800/80"
          >
            <div className="flex h-20 w-16 shrink-0 items-center justify-center bg-gradient-to-br from-violet-500/20 to-purple-500/20">
              <Headphones size={22} className="text-violet-400" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center py-2 pe-3">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
                  {item.title ?? 'Untitled'}
                </span>
                <ExternalLink size={10} className="shrink-0 text-zinc-600 group-hover:text-zinc-400" />
              </div>
              {item.channel && (
                <span className="mt-0.5 truncate text-xs text-zinc-500">
                  {item.channel}
                </span>
              )}
              {item.description && (
                <span className="mt-0.5 line-clamp-1 text-xs text-zinc-600">
                  {item.description}
                </span>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
}
