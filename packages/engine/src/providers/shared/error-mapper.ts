/**
 * Shared error mapping for provider adapters.
 * Maps SDK-specific errors to our ProviderError codes using a strategy pattern.
 */

import type { ProviderError, ProviderErrorCode } from '../types';
import { ProviderErrorImpl } from '../types';

/**
 * Extracts a status code and message from a provider-specific error.
 * Each provider supplies its own extractor for its SDK error type.
 */
export interface ErrorInfo {
  status?: number | undefined;
  message: string;
  cause?: Error | undefined;
}

export type StatusExtractor = (error: unknown) => ErrorInfo;

/**
 * Map a provider error to a ProviderError using common status code logic
 * and a provider-specific StatusExtractor.
 */
export function mapProviderError(error: unknown, extractor: StatusExtractor): ProviderError {
  const info = extractor(error);

  if (info.status === 401) {
    return new ProviderErrorImpl({
      code: 'AUTH_FAILED',
      message: info.message,
      retryable: false,
      cause: info.cause,
    });
  }

  if (info.status === 429) {
    return new ProviderErrorImpl({
      code: 'RATE_LIMITED',
      message: info.message,
      retryable: true,
      retryAfterMs: 60000,
      cause: info.cause,
    });
  }

  if (info.status === 404) {
    return new ProviderErrorImpl({
      code: 'MODEL_UNAVAILABLE',
      message: info.message,
      retryable: false,
      cause: info.cause,
    });
  }

  if (info.status === 400) {
    return new ProviderErrorImpl({
      code: 'CONTEXT_TOO_LONG',
      message: info.message,
      retryable: false,
      cause: info.cause,
    });
  }

  if (info.status !== undefined && info.status >= 500) {
    return new ProviderErrorImpl({
      code: 'PROVIDER_ERROR',
      message: info.message,
      retryable: true,
      cause: info.cause,
    });
  }

  return new ProviderErrorImpl({
    code: 'UNKNOWN',
    message: info.message,
    retryable: false,
    cause: info.cause,
  });
}

/**
 * Map an error using string pattern matching (for providers without typed SDK errors).
 * Checks error message for common patterns like '401', 'UNAUTHENTICATED', etc.
 */
export function mapErrorByMessage(error: unknown): ProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  const patterns: Array<{
    test: (msg: string) => boolean;
    code: ProviderErrorCode;
    retryable: boolean;
  }> = [
    {
      test: msg =>
        msg.includes('API key') || msg.includes('401') || msg.includes('UNAUTHENTICATED'),
      code: 'AUTH_FAILED',
      retryable: false,
    },
    {
      test: msg =>
        msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota'),
      code: 'RATE_LIMITED',
      retryable: true,
    },
    {
      test: msg => msg.includes('context') || msg.includes('too long') || msg.includes('token'),
      code: 'CONTEXT_TOO_LONG',
      retryable: false,
    },
    {
      test: msg => msg.includes('not found') || msg.includes('404'),
      code: 'MODEL_UNAVAILABLE',
      retryable: false,
    },
  ];

  for (const pattern of patterns) {
    if (pattern.test(message)) {
      return new ProviderErrorImpl({
        code: pattern.code,
        message,
        retryable: pattern.retryable,
        retryAfterMs: pattern.code === 'RATE_LIMITED' ? 60000 : undefined,
        cause,
      });
    }
  }

  return new ProviderErrorImpl({
    code: 'UNKNOWN',
    message,
    retryable: false,
    cause,
  });
}
