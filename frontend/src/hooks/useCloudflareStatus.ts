import { useQuery } from "@tanstack/react-query";
import { api } from "../utils/apiClient";

interface CloudflareStatus {
  isRunning: boolean;
  tunnelId: string | null;
  accountTag: string | null;
  publicUrl: string | null;
}

export const useCloudflareStatus = (enabled: boolean = true) => {
  return useQuery<CloudflareStatus>({
    queryKey: ["cloudflaredStatus"],
    queryFn: async () => {
      const res = await api.get("/settings/cloudflared/status");
      return res.data;
    },
    enabled: !!enabled,
    refetchInterval: enabled ? 10000 : false, // Poll every 10 seconds when enabled (reduced frequency)
    staleTime: 5000, // Consider data fresh for 5 seconds
    gcTime: 5 * 60 * 1000, // Garbage collect after 5 minutes
  });
};
