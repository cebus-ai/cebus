import {
  Zap, Shield, Globe, Star, Heart, Code, Cpu, Database,
  Layers, Lock, Rocket, Settings, Users, Eye, Package, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CardsData {
  cards?: { title: string; description?: string; icon?: string }[];
}

const ICON_MAP: Record<string, LucideIcon> = {
  zap: Zap,
  shield: Shield,
  globe: Globe,
  star: Star,
  heart: Heart,
  code: Code,
  cpu: Cpu,
  database: Database,
  layers: Layers,
  lock: Lock,
  rocket: Rocket,
  settings: Settings,
  users: Users,
  eye: Eye,
  package: Package,
  sparkles: Sparkles,
};

const CARD_COLORS = [
  'from-indigo-500/10 border-indigo-500/20',
  'from-violet-500/10 border-violet-500/20',
  'from-emerald-500/10 border-emerald-500/20',
  'from-amber-500/10 border-amber-500/20',
  'from-rose-500/10 border-rose-500/20',
  'from-cyan-500/10 border-cyan-500/20',
];

export default function CardsBlock({ data }: { data: unknown }) {
  const d = data as CardsData;
  const cards = d.cards ?? [];

  return (
    <div className="my-2 grid gap-2 text-start" style={{ gridTemplateColumns: `repeat(${cards.length <= 1 ? 1 : cards.length === 3 || cards.length === 6 ? 3 : 2}, 1fr)` }}>
      {cards.map((card, i) => {
        const Icon = ICON_MAP[card.icon?.toLowerCase() ?? ''] ?? Sparkles;
        const colorClass = CARD_COLORS[i % CARD_COLORS.length]!;

        return (
          <div
            key={i}
            className={`rounded-lg border bg-gradient-to-br to-transparent p-3 ${colorClass}`}
          >
            <Icon size={18} className="mb-2 text-zinc-400" />
            <div className="text-sm font-medium text-zinc-200">{card.title}</div>
            {card.description && (
              <div className="mt-1 text-xs leading-relaxed text-zinc-500">{card.description}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
