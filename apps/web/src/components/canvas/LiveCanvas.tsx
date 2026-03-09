import { useEffect, useMemo, useState } from 'react';
import { PenTool } from 'lucide-react';
import { MermaidDiagram } from '../artifacts/MermaidDiagram';
import { DiagramControls } from './DiagramControls';
import { useDiagramTransform } from '@/hooks/useDiagramTransform';

interface Message {
  content: string;
}

interface LiveCanvasProps {
  messages: Message[];
}

interface ExtractedDiagram {
  source: string;
  messageIndex: number;
}

export function extractAllMermaid(messages: Message[]): ExtractedDiagram[] {
  const diagrams: ExtractedDiagram[] = [];
  for (let i = 0; i < messages.length; i++) {
    const content = messages[i]!.content;
    for (const match of content.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)) {
      diagrams.push({ source: match[1]!.trim(), messageIndex: i });
    }
  }
  return diagrams;
}

export function LiveCanvas({ messages }: LiveCanvasProps) {
  const diagrams = useMemo(() => extractAllMermaid(messages), [messages]);
  const [selectedIndex, setSelectedIndex] = useState(diagrams.length - 1);

  useEffect(() => {
    if (diagrams.length > 0) {
      setSelectedIndex(diagrams.length - 1);
    }
  }, [diagrams.length]);

  const selectedSource = diagrams[selectedIndex]?.source ?? null;

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
  } = useDiagramTransform({ resetKey: selectedSource ?? undefined });

  if (!selectedSource) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-zinc-800 p-4">
          <PenTool size={28} className="text-zinc-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-400">No Diagram Yet</p>
          <p className="mt-1 max-w-[200px] text-xs text-zinc-600">
            Send a Mermaid code block to see it rendered here in real time
          </p>
        </div>
        <pre className="mt-2 rounded bg-zinc-800 px-3 py-2 text-[11px] text-zinc-500">
          {`\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\``}
        </pre>
      </div>
    );
  }

  return (
    <div
      data-canvas-root
      className={`flex flex-col bg-zinc-950 ${isFullscreen ? 'h-screen w-screen' : 'h-full'}`}
    >
      <DiagramControls
        source={selectedSource}
        scale={scale}
        isFullscreen={isFullscreen}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitToView={fitToView}
        onResetTransform={resetTransform}
        onToggleFullscreen={toggleFullscreen}
        diagramIndex={selectedIndex}
        totalDiagrams={diagrams.length}
        onPrev={() => setSelectedIndex((i) => Math.max(0, i - 1))}
        onNext={() => setSelectedIndex((i) => Math.min(diagrams.length - 1, i + 1))}
      />
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div style={transformStyle}>
          <MermaidDiagram source={selectedSource} className="!overflow-visible !min-h-0" />
        </div>
      </div>
    </div>
  );
}
