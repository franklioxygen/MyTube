import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../contexts/LanguageContext";
import { useSnackbar } from "../contexts/SnackbarContext";
import { Video } from "../types";
import { api } from "../utils/apiClient";
import { resolveSubscriptionErrorMessage } from "../utils/subscriptionErrors";
import { validateUrlForOpen } from "../utils/urlValidation";

interface UseVideoSubscriptionsProps {
  video: Video | undefined;
}

interface SubscriptionRecord {
  id: string;
  author?: string;
  authorUrl?: string;
  platform?: string;
}

const matchesVideoAuthor = (
  subscription: SubscriptionRecord,
  video: Video,
): boolean => {
  const subscriptionPlatform =
    typeof subscription.platform === "string"
      ? subscription.platform.toLowerCase()
      : "";
  return (
    subscription.author === video.author &&
    subscriptionPlatform === video.source.toLowerCase()
  );
};

/**
 * Custom hook to manage video subscriptions
 */
export function useVideoSubscriptions({ video }: UseVideoSubscriptionsProps) {
  const { t } = useLanguage();
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const [authorChannelUrl, setAuthorChannelUrl] = useState<string | null>(null);
  const [showSubscribeModal, setShowSubscribeModal] = useState<boolean>(false);

  // Fetch subscriptions
  const { data: subscriptions = [] } = useQuery<SubscriptionRecord[]>({
    queryKey: ["subscriptions"],
    queryFn: async () => {
      const response = await api.get("/subscriptions");
      return response.data as SubscriptionRecord[];
    },
  });

  // Get author channel URL
  useEffect(() => {
    const fetchChannelUrl = async () => {
      if (
        !video ||
        (video.source !== "youtube" &&
          video.source !== "bilibili" &&
          video.source !== "twitch")
      ) {
        setAuthorChannelUrl(null);
        return;
      }

      try {
        const response = await api.get("/videos/author-channel-url", {
          params: { sourceUrl: video.sourceUrl },
        });

        if (response.data.success && response.data.channelUrl) {
          setAuthorChannelUrl(response.data.channelUrl);
        } else {
          setAuthorChannelUrl(null);
        }
      } catch (error) {
        console.error("Error fetching author channel URL:", error);
        setAuthorChannelUrl(null);
      }
    };

    void fetchChannelUrl();
  }, [video]);

  // Check if author is subscribed
  const isSubscribed = useMemo(() => {
    if (subscriptions.length === 0) {
      return false;
    }

    // 1. Strict check by Channel URL (most accurate)
    if (authorChannelUrl) {
      const hasUrlMatch = subscriptions.some(
        (subscription) => subscription.authorUrl === authorChannelUrl
      );
      if (hasUrlMatch) return true;
    }

    // 2. Fallback check by Author Name and Platform matching
    if (video) {
      return subscriptions.some((subscription) =>
        matchesVideoAuthor(subscription, video)
      );
    }

    return false;
  }, [authorChannelUrl, subscriptions, video]);

  // Get subscription ID if subscribed
  const subscriptionId = useMemo(() => {
    if (subscriptions.length === 0) {
      return null;
    }

    // 1. Strict check by Channel URL
    if (authorChannelUrl) {
      const subscription = subscriptions.find(
        (item) => item.authorUrl === authorChannelUrl
      );
      if (subscription) return subscription.id;
    }

    // 2. Fallback check by Author Name and Platform matching
    if (video) {
      const subscription = subscriptions.find((item) =>
        matchesVideoAuthor(item, video)
      );
      if (subscription) return subscription.id;
    }

    return null;
  }, [authorChannelUrl, subscriptions, video]);

  // Handle navigation to author videos page or external channel
  const handleAuthorClick = () => {
    if (!video) return null;

    // If it's a YouTube or Bilibili video, try to get the channel URL
    if (
      video.source === "youtube" ||
      video.source === "bilibili" ||
      video.source === "twitch"
    ) {
      if (authorChannelUrl) {
        // Validate URL to prevent open redirect attacks
        const validatedUrl = validateUrlForOpen(authorChannelUrl);
        if (validatedUrl) {
          // Open the channel URL in a new tab
          window.open(validatedUrl, "_blank", "noopener,noreferrer");
          return null;
        }
      }
    }

    // Default behavior: navigate to author videos page
    // Note: navigate function should be passed from component
    return {
      shouldNavigate: true,
      path: `/author/${encodeURIComponent(video.author)}`,
    };
  };

  // Handle subscribe
  const handleSubscribe = () => {
    if (!authorChannelUrl) return;
    setShowSubscribeModal(true);
  };

  // Handle subscribe confirmation
  const handleSubscribeConfirm = async (
    interval: number,
    downloadAllPrevious: boolean,
    downloadShorts: boolean,
    downloadOrder: string
  ) => {
    if (!authorChannelUrl || !video) return;

    try {
      await api.post("/subscriptions", {
        url: authorChannelUrl,
        interval,
        authorName: video.author,
        downloadAllPrevious,
        downloadShorts,
        ...(downloadAllPrevious ? { downloadOrder } : {}),
      });
      showSnackbar(t("subscribedSuccessfully"));
      void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      setShowSubscribeModal(false);
    } catch (error: unknown) {
      console.error("Error subscribing:", error);
      if (isAxiosError(error) && error.response?.status === 409) {
        showSnackbar(t("subscriptionAlreadyExists"), "warning");
      } else {
        showSnackbar(
          resolveSubscriptionErrorMessage(error, video.source, t),
          "error"
        );
      }
      setShowSubscribeModal(false);
    }
  };

  // Handle unsubscribe
  const handleUnsubscribe = (onConfirm: () => void) => {
    if (!subscriptionId) return;

    onConfirm();
  };

  // Unsubscribe mutation
  const unsubscribeMutation = useMutation({
    mutationFn: async (subId: string) => {
      await api.delete(`/subscriptions/${subId}`);
    },
    onSuccess: () => {
      showSnackbar(t("unsubscribedSuccessfully"));
      void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
    onError: () => {
      showSnackbar(t("error"), "error");
    },
  });

  return {
    authorChannelUrl,
    isSubscribed,
    subscriptionId,
    showSubscribeModal,
    setShowSubscribeModal,
    handleAuthorClick,
    handleSubscribe,
    handleSubscribeConfirm,
    handleUnsubscribe,
    unsubscribeMutation,
  };
}
