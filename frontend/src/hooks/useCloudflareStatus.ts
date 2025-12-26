import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

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
      if (!enabled)
        return {
          isRunning: false,
          tunnelId: null,
          accountTag: null,
          publicUrl: null,
        };
      const res = await axios.get(`${API_URL}/settings/cloudflared/status`);
      return res.data;
    },
    enabled: !!enabled,
    refetchInterval: enabled ? 10000 : false, // Poll every 10 seconds when enabled (reduced frequency)
    staleTime: 5000, // Consider data fresh for 5 seconds
    gcTime: 5 * 60 * 1000, // Garbage collect after 5 minutes
  });
};
