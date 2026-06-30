import axios, { type AxiosError } from 'axios';

/**
 * Shared error helpers for the frontend.
 *
 * Use these instead of `catch (err: any)` + ad-hoc `err.response?.data?.error`
 * accesses. They keep the catch boundary typed as `unknown` and centralize the
 * axios-shape handling.
 */

/**
 * Extract the backend-provided error message from a thrown value, if it looks
 * like an axios error carrying `{ error: string }` in the response body.
 * Returns `undefined` when no such message is present.
 *
 * Matches both real AxiosError instances and plain objects with the same
 * response shape (tests and some call sites construct the latter).
 */
export function getApiErrorMessage(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ error?: string; message?: string }>;
    return axiosError.response?.data?.error ?? axiosError.response?.data?.message;
  }
  // Duck-type fallback: an object shaped like { response: { data: { error } } }.
  if (error && typeof error === 'object' && 'response' in error) {
    const data = (error as { response?: { data?: { error?: string; message?: string } } }).response?.data;
    if (data && (typeof data.error === 'string' || typeof data.message === 'string')) {
      return data.error ?? data.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return undefined;
}

/**
 * True when the thrown value is an axios error with the given HTTP status.
 * Matches both real AxiosError instances and plain objects with the same
 * response shape.
 */
export function hasAxiosStatus(error: unknown, status: number): boolean {
  const responseStatus = getResponseStatus(error);
  return responseStatus === status;
}

/**
 * True when the thrown value is an axios error with any of the given statuses.
 */
export function hasAnyAxiosStatus(error: unknown, statuses: number[]): boolean {
  const responseStatus = getResponseStatus(error);
  return responseStatus !== undefined && statuses.includes(responseStatus);
}

function getResponseStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }
  if (error && typeof error === 'object' && 'response' in error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
