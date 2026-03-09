import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.2;

interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

interface UseDiagramTransformOptions {
  resetKey?: string | undefined;
}

export function useDiagramTransform({ resetKey }: UseDiagramTransformOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, translateX: 0, translateY: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // Reset on source change
  useEffect(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  }, [resetKey]);

  // Sync fullscreen state and auto-fit when entering fullscreen
  useEffect(() => {
    const onFullscreenChange = () => {
      const entering = !!document.fullscreenElement;
      setIsFullscreen(entering);
      if (!entering) {
        setTransform({ scale: 1, translateX: 0, translateY: 0 });
      } else {
        // Wait for layout to settle at new viewport size, then fit
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const container = containerRef.current;
            if (!container) return;
            const svg = container.querySelector('svg');
            if (!svg) return;

            const cw = container.clientWidth;
            const ch = container.clientHeight;
            // Get natural SVG size by reading viewBox or resetting scale
            const viewBox = svg.getAttribute('viewBox');
            let sw: number;
            let sh: number;
            if (viewBox) {
              const parts = viewBox.split(/[\s,]+/).map(Number);
              sw = parts[2]!;
              sh = parts[3]!;
            } else {
              const rect = svg.getBoundingClientRect();
              sw = rect.width;
              sh = rect.height;
            }
            if (sw === 0 || sh === 0) return;

            const scale = Math.min(1, Math.max(MIN_SCALE, Math.min(cw / sw, ch / sh)));
            setTransform({
              scale,
              translateX: (cw - sw * scale) / 2,
              translateY: (ch - sh * scale) / 2,
            });
          });
        });
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    setTransform((prev) => {
      const direction = e.deltaY < 0 ? 1 : -1;
      const newScale = clampScale(prev.scale + direction * ZOOM_STEP);
      const ratio = newScale / prev.scale;
      return {
        scale: newScale,
        translateX: pointerX - ratio * (pointerX - prev.translateX),
        translateY: pointerY - ratio * (pointerY - prev.translateY),
      };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.translateX, ty: transform.translateY };
  }, [transform.translateX, transform.translateY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTransform((prev) => ({
      ...prev,
      translateX: dragStart.current.tx + dx,
      translateY: dragStart.current.ty + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const zoomIn = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: clampScale(prev.scale + ZOOM_STEP) }));
  }, []);

  const zoomOut = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: clampScale(prev.scale - ZOOM_STEP) }));
  }, []);

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const sw = svg.getBoundingClientRect().width / transform.scale;
    const sh = svg.getBoundingClientRect().height / transform.scale;
    if (sw === 0 || sh === 0) return;

    const scale = clampScale(Math.min(cw / sw, ch / sh) * 0.9);
    setTransform({
      scale,
      translateX: (cw - sw * scale) / 2,
      translateY: (ch - sh * scale) / 2,
    });
  }, [transform.scale]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    const root = containerRef.current?.closest('[data-canvas-root]') as HTMLElement | null;
    if (root) root.requestFullscreen();
  }, []);

  const transformStyle: React.CSSProperties = {
    transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
    transformOrigin: '0 0',
  };

  return {
    containerRef,
    transformStyle,
    scale: transform.scale,
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
  };
}
