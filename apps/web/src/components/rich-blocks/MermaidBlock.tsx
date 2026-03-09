import { useState } from 'react';
import { Code, Copy, Check, GitBranch, Maximize2, Minimize2, Minus, Plus, RotateCcw, Scan } from 'lucide-react';
import { useMermaidRender } from '@/hooks/useMermaidRender';
import { useDiagramTransform } from '@/hooks/useDiagramTransform';

interface MermaidBlockProps {
  source: string;
}

const btnClass =
  'flex items-center justify-center rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300';

export default function MermaidBlock({ source }: MermaidBlockProps) {
  const { containerRef: renderRef, error } = useMermaidRender(source);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    containerRef,
    transformStyle,
    scale,
    isFullscreen,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    zoomIn,
    zoomOut,
    resetTransform,
    fitToView,
    toggleFullscreen,
  } = useDiagramTransform({ resetKey: source });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error) {
    return (
      <div className="my-2 overflow-hidden rounded-lg border border-red-900/50 bg-red-950/20">
        <div className="border-b border-red-900/30 px-3 py-1 text-[10px] font-medium text-red-400">
          DIAGRAM ERROR
        </div>
        <pre className="overflow-x-auto p-3 text-sm text-zinc-400">{source}</pre>
        <div className="border-t border-red-900/30 px-3 py-1 text-[10px] text-red-400/70">{error}</div>
      </div>
    );
  }

  return (
    <div
      data-canvas-root
      className={`overflow-hidden text-start ${isFullscreen ? 'flex h-screen w-screen flex-col bg-zinc-950' : 'my-2 rounded-lg border border-zinc-700 bg-zinc-900'}`}
    >
      <div className="flex items-center gap-1 border-b border-zinc-700 px-2 py-1">
        <GitBranch size={12} className="text-emerald-400" />
        <span className="mr-auto text-[10px] font-medium text-emerald-400">DIAGRAM</span>

        <button onClick={zoomOut} className={btnClass} title="Zoom out">
          <Minus size={12} />
        </button>
        <span className="min-w-[3ch] text-center text-[10px] tabular-nums text-zinc-500">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={zoomIn} className={btnClass} title="Zoom in">
          <Plus size={12} />
        </button>
        <button onClick={fitToView} className={btnClass} title="Fit to view">
          <Scan size={12} />
        </button>
        <button onClick={resetTransform} className={btnClass} title="Reset view">
          <RotateCcw size={12} />
        </button>

        <div className="mx-0.5 h-3 w-px bg-zinc-700" />

        <button
          onClick={() => setShowCode((v) => !v)}
          className={`${btnClass} ${showCode ? 'text-indigo-400' : ''}`}
          title={showCode ? 'Hide source' : 'Show source'}
        >
          <Code size={12} />
        </button>
        <button onClick={handleCopy} className={btnClass} title="Copy source">
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        <button onClick={toggleFullscreen} className={btnClass} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>

      {showCode && (
        <pre className="max-h-48 overflow-auto border-b border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-400">
          {source}
        </pre>
      )}

      <div
        ref={containerRef}
        className={`overflow-hidden cursor-grab active:cursor-grabbing ${isFullscreen ? 'flex-1' : ''}`}
        style={isFullscreen ? undefined : { minHeight: '120px' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div style={transformStyle}>
          <div
            ref={renderRef}
            className="mermaid-diagram flex items-center justify-center p-4 [&_svg]:max-w-full"
          />
        </div>
      </div>
    </div>
  );
}
