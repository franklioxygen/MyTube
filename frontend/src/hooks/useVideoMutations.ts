import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "../contexts/LanguageContext";
import { useSnackbar } from "../contexts/SnackbarContext";
import { useVideo } from "../contexts/VideoContext";
import { Video } from "../types";
import { api } from "../utils/apiClient";

interface UseVideoMutationsProps {
  videoId: string | undefined;
  onDeleteSuccess?: () => void;
}

/**
 * Custom hook to manage all video-related API mutations
 */
export function useVideoMutations({
  videoId,
  onDeleteSuccess,
}: UseVideoMutationsProps) {
  const { t } = useLanguage();
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const { deleteVideo } = useVideo();

  // Rating mutation
  const ratingMutation = useMutation({
    mutationFn: async (newValue: number) => {
      await api.post(`/videos/${videoId}/rate`, {
        rating: newValue,
      });
      return newValue;
    },
    onSuccess: (newValue) => {
      queryClient.setQueryData(["video", videoId], (old: Video | undefined) =>
        old ? { ...old, rating: newValue } : old
      );
    },
  });

  // Title mutation
  const titleMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      const response = await api.put(`/videos/${videoId}`, {
        title: newTitle,
      });
      return response.data;
    },
    onSuccess: (data, newTitle) => {
      if (data.success) {
        queryClient.setQueryData(["video", videoId], (old: Video | undefined) =>
          old ? { ...old, title: newTitle } : old
        );
        showSnackbar(t("titleUpdated"));
      }
    },
    onError: () => {
      showSnackbar(t("titleUpdateFailed"), "error");
    },
  });

  // Tags mutation
  const tagsMutation = useMutation({
    mutationFn: async (newTags: string[]) => {
      const response = await api.put(`/videos/${videoId}`, {
        tags: newTags,
      });
      return response.data;
    },
    onSuccess: (data, newTags) => {
      if (data.success) {
        queryClient.setQueryData(["video", videoId], (old: Video | undefined) =>
          old ? { ...old, tags: newTags } : old
        );
      }
    },
    onError: () => {
      showSnackbar(t("error"), "error");
    },
  });

  // Visibility mutation
  const visibilityMutation = useMutation({
    mutationFn: async (visibility: number) => {
      const response = await api.put(`/videos/${videoId}`, {
        visibility,
      });
      return response.data;
    },
    onSuccess: (data, visibility) => {
      if (data.success) {
        queryClient.setQueryData(["video", videoId], (old: Video | undefined) =>
          old ? { ...old, visibility } : old
        );
        queryClient.setQueryData(["videos"], (old: Video[] | undefined) =>
          old
            ? old.map((v) => (v.id === videoId ? { ...v, visibility } : v))
            : []
        );
        showSnackbar(
          visibility === 1 ? t("showVideo") : t("hideVideo"),
          "success"
        );
      }
    },
    onError: () => {
      showSnackbar(t("error"), "error");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (videoIdToDelete: string) => {
      return await deleteVideo(videoIdToDelete);
    },
    onSuccess: (result) => {
      if (result.success) {
        onDeleteSuccess?.();
      }
    },
  });

  // Upload subtitle mutation
  const uploadSubtitleMutation = useMutation({
    mutationFn: async ({
      file,
      language,
    }: {
      file: File;
      language?: string;
    }) => {
      const formData = new FormData();
      formData.append("subtitle", file);
      if (language) {
        formData.append("language", language);
      }

      const response = await api.post(
        `/videos/${videoId}/subtitles`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.setQueryData(
          ["video", videoId],
          (old: Video | undefined) => {
            if (!old) return old;
            const currentSubtitles = old.subtitles || [];
            return {
              ...old,
              subtitles: [...currentSubtitles, data.data.subtitle],
            };
          }
        );
        showSnackbar(
          t("subtitleUploaded") || "Subtitle uploaded successfully",
          "success"
        );
      }
    },
    onError: (error: unknown) => {
      const fallback = t("uploadFailed") || "Upload failed";
      let message = fallback;
      if (error && typeof error === "object" && "response" in error) {
        const res = (
          error as {
            response?: { data?: { message?: string; error?: string } };
          }
        ).response;
        message = res?.data?.message ?? res?.data?.error ?? fallback;
      }
      showSnackbar(message, "error");
    },
  });

  // Delete subtitle mutation (updates video with subtitles array minus one)
  const deleteSubtitleMutation = useMutation({
    mutationFn: async ({
      index,
      currentSubtitles,
    }: {
      index: number;
      currentSubtitles: Array<{
        language: string;
        filename: string;
        path: string;
      }>;
    }) => {
      const next = currentSubtitles.filter((_, i) => i !== index);
      await api.put(`/videos/${videoId}`, { subtitles: next });
      return { index, next };
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["video", videoId], (old: Video | undefined) => {
        if (!old) return old;
        return { ...old, subtitles: payload.next };
      });
      showSnackbar(t("subtitleDeleted") || "Subtitle deleted", "success");
    },
    onError: () => {
      showSnackbar(t("deleteFailed") || "Failed to delete", "error");
    },
  });

  return {
    ratingMutation,
    titleMutation,
    tagsMutation,
    visibilityMutation,
    deleteMutation,
    uploadSubtitleMutation,
    deleteSubtitleMutation,
  };
}
