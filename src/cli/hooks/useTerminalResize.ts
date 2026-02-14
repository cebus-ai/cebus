import { useEffect, useRef, useState } from 'react';

export function useTerminalResize(): number {
  const [resizeKey, setResizeKey] = useState(0);
  const lastColsRef = useRef(process.stdout.columns ?? 120);
  const lastRowsRef = useRef(process.stdout.rows ?? 40);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onResize = (): void => {
      const newCols = process.stdout.columns ?? 120;
      const newRows = process.stdout.rows ?? 40;
      if (newCols !== lastColsRef.current || newRows !== lastRowsRef.current) {
        lastColsRef.current = newCols;
        lastRowsRef.current = newRows;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setResizeKey(k => k + 1);
        }, 32);
      }
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return resizeKey;
}
