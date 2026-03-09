import DOMPurify from 'dompurify';
import { useEffect, useRef, useState } from 'react';

const MERMAID_THEME_VARIABLES = {
  primaryColor: '#6366f1',
  primaryTextColor: '#e4e4e7',
  primaryBorderColor: '#3f3f46',
  lineColor: '#71717a',
  secondaryColor: '#27272a',
  tertiaryColor: '#18181b',
};

let mermaidInitialized = false;

async function ensureMermaidInit() {
  const mermaid = (await import('mermaid')).default;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      themeVariables: MERMAID_THEME_VARIABLES,
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

export function useMermaidRender(source: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!containerRef.current || !source.trim()) return;

      try {
        const mermaid = await ensureMermaidInit();
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source.trim());

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject', 'style'],
          });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Invalid Mermaid syntax');
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [source]);

  return { containerRef, error };
}
