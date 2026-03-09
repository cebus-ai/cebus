import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Scan,
} from 'lucide-react';

interface DiagramControlsProps {
  source: string;
  scale: number;
  isFullscreen: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
  onResetTransform: () => void;
  onToggleFullscreen: () => void;
  diagramIndex?: number | undefined;
  totalDiagrams?: number | undefined;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}

const btnClass =
  'flex items-center justify-center rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300';

const disabledBtnClass =
  'flex items-center justify-center rounded p-1 text-zinc-700 cursor-not-allowed';

const divider = <div className="mx-0.5 h-4 w-px bg-zinc-800" />;

export function DiagramControls({
  source,
  scale,
  isFullscreen,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onResetTransform,
  onToggleFullscreen,
  diagramIndex,
  totalDiagrams,
  onPrev,
  onNext,
}: DiagramControlsProps) {
  const handleCopySource = async () => {
    await navigator.clipboard.writeText(source);
  };

  const handleExportSVG = () => {
    const svgEl = document.querySelector('.mermaid-diagram svg') as SVGElement | null;
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'diagram.svg';
    link.click();
    URL.revokeObjectURL(url);
  };

  const showNav =
    totalDiagrams !== undefined && totalDiagrams > 1 && diagramIndex !== undefined;
  const atFirst = diagramIndex === 0;
  const atLast = diagramIndex === (totalDiagrams ?? 1) - 1;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
      {showNav && (
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={atFirst}
            className={atFirst ? disabledBtnClass : btnClass}
            title="Previous diagram"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-[4ch] text-center text-[11px] tabular-nums text-zinc-500">
            {diagramIndex! + 1} / {totalDiagrams}
          </span>
          <button
            onClick={onNext}
            disabled={atLast}
            className={atLast ? disabledBtnClass : btnClass}
            title="Next diagram"
          >
            <ChevronRight size={14} />
          </button>
          {divider}
        </div>
      )}

      <div className="flex items-center gap-1">
        <button onClick={onZoomOut} className={btnClass} title="Zoom out">
          <Minus size={14} />
        </button>
        <span className="min-w-[3ch] text-center text-[11px] tabular-nums text-zinc-500">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={onZoomIn} className={btnClass} title="Zoom in">
          <Plus size={14} />
        </button>
        <button onClick={onFitToView} className={btnClass} title="Fit to view">
          <Scan size={14} />
        </button>
        <button onClick={onResetTransform} className={btnClass} title="Reset view">
          <RotateCcw size={14} />
        </button>
        {divider}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handleCopySource}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          title="Copy source"
        >
          <Copy size={12} />
          Source
        </button>
        <button
          onClick={handleExportSVG}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          title="Export SVG"
        >
          <Download size={12} />
          SVG
        </button>
        {divider}
      </div>

      <button
        onClick={onToggleFullscreen}
        className={btnClass}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}
