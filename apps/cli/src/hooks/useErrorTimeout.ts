import type React from 'react';
import { useEffect } from 'react';

/**
 * Auto-clears the error message after 5 seconds.
 */
export function useErrorTimeout(
  error: string | null,
  setError: React.Dispatch<React.SetStateAction<string | null>>
): void {
  useEffect(() => {
    if (error !== null) {
      const timeout = setTimeout(() => setError(null), 5000);
      return (): void => {
        clearTimeout(timeout);
      };
    }
    return undefined;
  }, [error, setError]);
}
