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

// Create axios instance with default configuration
const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30000, // 30 seconds default timeout
  withCredentials: true, // Required for HTTP-only cookies
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Request interceptor - can be used for adding auth tokens, logging, etc.
 * Note: Authentication is now handled via HTTP-only cookies, so no Authorization header is needed
 */
apiClient.interceptors.request.use(
  (config) => {
    // Cookies are automatically sent with requests when withCredentials: true
    // No need to manually add Authorization header
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor - handles common error patterns
 */
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
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
      console.error("Network error - no response received:", error.config?.url);
    } else {
      // Something else happened
      console.error("Request setup error:", error.message);
    }

    return Promise.reject(error);
  }
);

/**
 * Type-safe API response wrapper
 */
export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  [key: string]: any; // Allow additional properties for backward compatibility
}

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
 * Extract wait time from rate limit error (429 or 401 with waitTime)
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
    return apiClient.post<T>(url, data, config);
  },

  /**
   * PUT request
   */
  put: <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    return apiClient.put<T>(url, data, config);
  },

  /**
   * PATCH request
   */
  patch: <T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    return apiClient.patch<T>(url, data, config);
  },

  /**
   * DELETE request
   */
  delete: <T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
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
