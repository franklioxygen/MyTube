import { useQuery } from "@tanstack/react-query";
import { api } from "../utils/apiClient";

export type ScanType = "files" | "mount";

export interface ScanStatus {
  scanning: boolean;
  scanType: ScanType | null;
  startedAt: string | null;
}

const ACTIVE_POLL_INTERVAL_MS = 2000;
const IDLE_POLL_INTERVAL_MS = 15000;

const IDLE_STATUS: ScanStatus = {
  scanning: false,
  scanType: null,
  startedAt: null,
};

/**
 * Tracks the server-side scan state so a scan started elsewhere - or before the
 * current page was remounted - still shows as running.
 */
export const useScanStatus = (enabled: boolean = true) => {
  return useQuery<ScanStatus>({
    queryKey: ["scanStatus"],
    queryFn: async () => {
      const res = await api.get("/scan-status");
      return res.data;
    },
    enabled: !!enabled,
    // Poll with a dynamic interval: fast while a scan runs, low-frequency when
    // idle so a scan started from another tab still surfaces here.
    refetchInterval: (query) =>
      (query.state.data as ScanStatus | undefined)?.scanning
        ? ACTIVE_POLL_INTERVAL_MS
        : IDLE_POLL_INTERVAL_MS,
    // Always refetch on mount so returning to the page picks up a running scan.
    refetchOnMount: "always",
    initialData: IDLE_STATUS,
    staleTime: 1000,
    gcTime: 5 * 60 * 1000,
  });
};
