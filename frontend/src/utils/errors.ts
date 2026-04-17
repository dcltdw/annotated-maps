import { AxiosError } from 'axios';
import type { ApiError } from '@/types';

/**
 * Extract a user-displayable error message from an AxiosError or generic
 * exception. Prefers backend's `message` field (human-readable), falls back
 * to `error` code, then the supplied fallback string.
 *
 * Use this in every component catch block to keep error display consistent.
 */
export function extractApiError(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const data = (err as AxiosError<ApiError>).response?.data;
    return data?.message ?? data?.error ?? fallback;
  }
  return fallback;
}

/**
 * Get the backend's machine-readable error code (e.g. 'email_taken').
 * Returns undefined if the error isn't an AxiosError or has no code.
 *
 * Use this when you need to switch on specific error codes for custom UX.
 */
export function getApiErrorCode(err: unknown): string | undefined {
  if (err instanceof AxiosError) {
    return (err as AxiosError<ApiError>).response?.data?.error;
  }
  return undefined;
}
