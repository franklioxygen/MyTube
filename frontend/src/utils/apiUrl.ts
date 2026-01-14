/**
 * Get API URL with proper defaults for development and production
 * In dev mode, uses relative path to leverage Vite proxy
 * In production or when VITE_API_URL is explicitly set, uses that value
 */
export const getApiUrl = (): string => {
  return (
    import.meta.env.VITE_API_URL ??
    (import.meta.env.DEV ? "/api" : "http://localhost:5551/api")
  );
};

/**
 * Get backend URL with proper defaults for development and production
 * In dev mode, uses empty string (relative path) to leverage Vite proxy
 * In production or when VITE_BACKEND_URL is explicitly set, uses that value
 */
export const getBackendUrl = (): string => {
  return (
    import.meta.env.VITE_BACKEND_URL ??
    (import.meta.env.DEV ? "" : "http://localhost:5551")
  );
};
