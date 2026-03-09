import { useMermaidRender } from '@/hooks/useMermaidRender';

interface MermaidDiagramProps {
  source: string;
  className?: string;
}

export function MermaidDiagram({ source, className }: MermaidDiagramProps) {
  const { containerRef, error } = useMermaidRender(source);

  if (error) {
    return (
      <div className={`rounded border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400 ${className ?? ''}`}>
        Diagram error: {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mermaid-diagram flex items-center justify-center overflow-auto rounded bg-zinc-900 p-4 ${className ?? ''}`}
    />
  );
}
