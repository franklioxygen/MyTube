import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../utils/apiClient";

/**
 * Single source of truth for the subscriptions list query (key + fetcher), so
 * callers and cache invalidations stay consistent instead of each re-declaring
 * `useQuery({ queryKey: ['subscriptions'], queryFn: () => api.get('/subscriptions') })`.
 * Modeled on `settingsQueryOptions`.
 */
export const SUBSCRIPTIONS_QUERY_KEY = ["subscriptions"] as const;

export const fetchSubscriptions = async <T = unknown>(): Promise<T> => {
  const response = await api.get("/subscriptions");
  return response.data as T;
};

/**
 * Fetch the subscriptions list. Generic over the row shape so each caller can
 * keep its own typing; extra react-query options (polling, staleTime, …) can be
 * merged in.
 */
export function useSubscriptions<T = unknown>(
  options?: Omit<UseQueryOptions<T, Error, T>, "queryKey" | "queryFn">
): UseQueryResult<T, Error> {
  return useQuery<T, Error, T>({
    queryKey: SUBSCRIPTIONS_QUERY_KEY,
    queryFn: () => fetchSubscriptions<T>(),
    ...options,
  });
}
