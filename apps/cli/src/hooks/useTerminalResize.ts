import { useEffect, useRef, useState } from 'react';
import { clearScreen } from '../ui';

export function useTerminalResize(): number {
  const [resizeKey, setResizeKey] = useState(0);
  const lastColsRef = useRef(process.stdout.columns ?? 120);
  const lastRowsRef = useRef(process.stdout.rows ?? 40);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onResize = (): void => {
      const newCols = process.stdout.columns ?? 120;
      if (newCols !== lastColsRef.current) {
        lastColsRef.current = newCols;
        clearScreen();
      }
    };
    process.stdout.on('resize', onResize);
    return (): void => {
      process.stdout.off('resize', onResize);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return resizeKey;
}
