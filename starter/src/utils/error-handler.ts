/**
 * Custom error class for review operations
 */
export class ReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReviewError';
    Error.captureStackTrace(this, ReviewError);
  }
}

/**
 * Error codes for the review system
 */
export const ErrorCodes = {
  // Configuration errors
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',

  // GitHub errors
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Agent errors
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',

  // General errors
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Retry utility with exponential backoff
 *
 * This function implements the retry pattern with exponential backoff and jitter.
 *
 * Algorithm:
 * 1. Try to execute the function
 * 2. If it succeeds, return the result
 * 3. If it fails and retries remain:
 *    - Calculate backoff delay: delayMs * 2^(attempt - 1)
 *    - Add jitter (random 0-100ms) to prevent thundering herd
 *    - Wait for the calculated duration
 *    - Retry
 * 4. If all retries exhausted, throw ReviewError with RETRY_EXHAUSTED code
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param delayMs - Base delay in milliseconds (default: 1000)
 * @returns The result of the successful function execution
 * @throws ReviewError with RETRY_EXHAUSTED code if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
  signal?: AbortSignal,
  shouldRetry: (error: unknown) => boolean = () => true
): Promise<T> {
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    throw new ReviewError(
      `maxRetries must be an integer >= 1, got ${maxRetries}`,
      ErrorCodes.INVALID_CONFIG,
      { maxRetries }
    );
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Stop immediately if cancelled, or if this error is not worth retrying
      // (rethrown as-is so the original error code reaches the caller)
      if (signal?.aborted || !shouldRetry(error)) throw error;

      // Only wait if another attempt follows
      if (attempt < maxRetries) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 100;
        await new Promise(resolve => setTimeout(resolve, backoff + jitter));
      }
    }
  }

  const reason = formatError(lastError);
  throw new ReviewError(
    `Operation failed after ${maxRetries} attempt(s): ${reason}`,
    ErrorCodes.RETRY_EXHAUSTED,
    { attempts: maxRetries, lastError: reason }
  );
}

/**
 * Wrap an async function with timeout.
 * fn receives an AbortSignal that is aborted when the timeout fires,
 * so the underlying work (HTTP request, SDK query) can be cancelled.
 *
 * @param fn - Async function that accepts an AbortSignal
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message
 * @throws ReviewError with AGENT_TIMEOUT code if timeout is reached
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new ReviewError(
      `timeoutMs must be an integer >= 1, got ${timeoutMs}`,
      ErrorCodes.INVALID_CONFIG,
      { timeoutMs }
    );
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the timeout error wins the race, then cancel the work
      reject(new ReviewError(errorMessage, ErrorCodes.AGENT_TIMEOUT, { timeoutMs }));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if an error is a ReviewError
 */
export function isReviewError(error: unknown): error is ReviewError {
  return error instanceof ReviewError;
}

/**
 * Format error for logging/display
 */
export function formatError(error: unknown): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}