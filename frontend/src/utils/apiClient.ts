import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import { getApiUrl } from "./apiUrl";

/**
 * Centralized API client for all backend API calls
 * Provides consistent error handling, request/response interceptors, and type safety
 */

// Get API URL using centralized helper function
// In dev mode, uses relative path to leverage Vite proxy
// In production or when VITE_API_URL is explicitly set, uses that value
const API_URL = getApiUrl();

// Stores the latest CSRF token received from the server
let csrfToken: string | null = null;

// Create axios instance with safe fallback for mocked test environments.
const createdClient =
  typeof axios.create === "function"
    ? axios.create({
        baseURL: API_URL,
        timeout: 30000, // 30 seconds default timeout
        withCredentials: true, // Required for HTTP-only cookies
        headers: {
          "Content-Type": "application/json",
        },
      })
    : null;

const apiClient: AxiosInstance =
  (createdClient as AxiosInstance | null) ??
  (axios as unknown as AxiosInstance);

/**
 * Request interceptor - can be used for adding auth tokens, logging, etc.
 * Note: Authentication is now handled via HTTP-only cookies, so no Authorization header is needed
 */
if (apiClient?.interceptors?.request?.use) {
  apiClient.interceptors.request.use(
    (config) => {
      // Attach CSRF token to state-changing requests
      if (csrfToken) {
        config.headers["X-CSRF-Token"] = csrfToken;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );
}

/**
 * Response interceptor - handles common error patterns
 */
if (apiClient?.interceptors?.response?.use) {
  apiClient.interceptors.response.use(
    (response: AxiosResponse) => {
      // Capture CSRF token from response header for subsequent requests
      const newCsrfToken = response.headers["x-csrf-token"];
      if (newCsrfToken) {
        csrfToken = newCsrfToken;
      }
      return response;
    },
    (error: AxiosError) => {
      // Handle common error cases
      if (error.response) {
        // Server responded with error status
        const status = error.response.status;
        const data = error.response.data as any;

        // Handle specific error cases
        if (status === 401) {
          // Unauthorized - could trigger logout or redirect
          console.error("Unauthorized request:", error.config?.url);
        } else if (status === 403) {
          // Forbidden
          console.error("Forbidden request:", error.config?.url);
        } else if (status === 404) {
          // Not found
          console.error("Resource not found:", error.config?.url);
        } else if (status === 429) {
          // Too many requests
          console.error("Rate limited:", error.config?.url);
        } else if (status >= 500) {
          // Server error
          console.error("Server error:", error.config?.url, data);
        }
      } else if (error.request) {
        // Request was made but no response received
        console.error(
          "Network error - no response received:",
          error.config?.url
        );
      } else {
        // Something else happened
        console.error("Request setup error:", error.message);
      }

      return Promise.reject(error);
    }
  );
}

type EnsureCsrfTokenOptions = {
  refresh?: boolean;
};

export const ensureCsrfToken = async (
  options: EnsureCsrfTokenOptions = {}
): Promise<void> => {
  if (csrfToken && options.refresh !== true) {
    return;
  }

  await apiClient.get("/settings/password-enabled", { timeout: 5000 });
};

/**
 * Wrapper around native fetch that injects the CSRF token and session cookies.
 * Use instead of raw fetch() for state-changing requests that need streaming responses.
 */
const buildCloudSyncRequestUrl = (): string => {
  const baseURL = API_URL.replace(/\/$/, "");
  const requestUrl = `${baseURL}/cloud/sync`;

  if (requestUrl.startsWith("/")) {
    return new URL(requestUrl, globalThis.location.origin).toString();
  }

  return requestUrl;
};

export const fetchCloudSyncWithCsrf = async (
  init: RequestInit = {}
): Promise<Response> => {
  await ensureCsrfToken();
  const headers = new Headers(init.headers);
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  // Fixed internal endpoint; the URL is not user-controlled.
  // nosemgrep
  const request = new Request(buildCloudSyncRequestUrl(), {
    ...init,
    credentials: "include",
    headers,
  });

  return fetch(request);
};

/**
 * Type-safe API response wrapper
 */
export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: string;
  errorKey?: string;
  details?: string;
  message?: string;
  [key: string]: any; // Allow additional properties for backward compatibility
}

type TranslationFn = (
  key: string,
  replacements?: Record<string, string | number>
) => string;

type BlobLikeResponse = {
  constructor?: { name?: string };
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

const isNamedBlob = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  ((value as BlobLikeResponse).constructor?.name === "Blob" ||
    Object.prototype.toString.call(value) === "[object Blob]");

const isBlobResponse = (value: unknown): value is BlobLikeResponse =>
  isNamedBlob(value);

const readBlobText = async (data: BlobLikeResponse): Promise<string | undefined> => {
  if (typeof data.text === "function") {
    return data.text();
  }
  if (typeof data.arrayBuffer === "function") {
    return new TextDecoder().decode(await data.arrayBuffer());
  }
  if (typeof Response !== "undefined") {
    try {
      return await new Response(data as BodyInit).text();
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const normalizeApiErrorData = async (
  data: unknown
): Promise<ApiResponse | undefined> => {
  if (!data) {
    return undefined;
  }

  if (isBlobResponse(data)) {
    const text = await readBlobText(data);
    if (text === undefined) {
      return undefined;
    }
    return normalizeApiErrorData(text);
  }

  if (typeof data === "string") {
    if (!data.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(data) as ApiResponse;
    } catch {
      return { message: data };
    }
  }

  if (typeof data === "object") {
    return data as ApiResponse;
  }

  return undefined;
};

/**
 * Extract error message from axios error
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiResponse>;
    if (axiosError.response?.data?.error) {
      return axiosError.response.data.error;
    }
    if (axiosError.response?.data?.message) {
      return axiosError.response.data.message;
    }
    if (axiosError.message) {
      return axiosError.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unknown error occurred";
}

/**
 * Extract and normalize structured API error data.
 * Supports JSON error payloads returned as objects, strings, or blobs.
 */
export async function getApiErrorData(
  error: unknown
): Promise<ApiResponse | undefined> {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }

  const axiosError = error as AxiosError<ApiResponse>;
  return normalizeApiErrorData(axiosError.response?.data);
}

/**
 * Extract the most useful user-facing API error message, optionally translating errorKey values.
 */
export async function getApiErrorMessage(
  error: unknown,
  t?: TranslationFn
): Promise<string | undefined> {
  const data = await getApiErrorData(error);
  const errorKey = typeof data?.errorKey === "string" ? data.errorKey : undefined;

  if (errorKey && t) {
    const translated = t(errorKey);
    if (translated && translated !== errorKey) {
      return translated;
    }
  }

  if (typeof data?.error === "string" && data.error) {
    return data.error;
  }
  if (typeof data?.details === "string" && data.details) {
    return data.details;
  }
  if (typeof data?.message === "string" && data.message) {
    return data.message;
  }

  const fallback = getErrorMessage(error);
  return fallback || undefined;
}

/**
 * Extract wait time from server error payloads, typically rate-limit responses.
 */
export function getWaitTime(error: unknown): number {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ waitTime?: number }>;
    if (axiosError.response?.data?.waitTime) {
      return axiosError.response.data.waitTime;
    }
  }
  return 0;
}

/**
 * Check if error is a rate limit error (429)
 */
export function isRateLimitError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 429;
  }
  return false;
}

/**
 * Check if error is an authentication error (401)
 */
export function isAuthError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 401;
  }
  return false;
}

/**
 * API client methods - type-safe wrappers around axios
 */
export const api = {
  /**
   * GET request
   */
  get: <T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    if (config === undefined) {
      return apiClient.get<T>(url);
    }
    return apiClient.get<T>(url, config);
  },

  /**
   * POST request
   */
  post: <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    if (config !== undefined) {
      return apiClient.post<T>(url, data, config);
    }
    if (data !== undefined) {
      return apiClient.post<T>(url, data);
    }
    return apiClient.post<T>(url);
  },

  /**
   * PUT request
   */
  put: <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    if (config !== undefined) {
      return apiClient.put<T>(url, data, config);
    }
    if (data !== undefined) {
      return apiClient.put<T>(url, data);
    }
    return apiClient.put<T>(url);
  },

  /**
   * PATCH request
   */
  patch: <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    if (config !== undefined) {
      return apiClient.patch<T>(url, data, config);
    }
    if (data !== undefined) {
      return apiClient.patch<T>(url, data);
    }
    return apiClient.patch<T>(url);
  },

  /**
   * DELETE request
   */
  delete: <T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    if (config === undefined) {
      return apiClient.delete<T>(url);
    }
    return apiClient.delete<T>(url, config);
  },
};

/**
 * Export the axios instance for advanced use cases
 */
export { apiClient };

/**
 * Export API_URL for cases where it's needed directly
 */
export { API_URL };

export default api;
