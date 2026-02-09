import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "../contexts/LanguageContext";
import { Settings } from "../types";
import { api } from "../utils/apiClient";
import { generateTimestamp } from "../utils/formatUtils";
import { InfoModalState } from "./useSettingsModals";

interface UseSettingsMutationsProps {
  setMessage: (
    message: {
      text: string;
      type: "success" | "error" | "warning" | "info";
    } | null
  ) => void;
  setInfoModal: (modal: InfoModalState) => void;
}

interface SaveSettingsMutationResult {
  skipped: boolean;
  patchPayload: Partial<Settings>;
}

const areSettingValuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null
  ) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
};

const buildSettingsPatchPayload = (
  newSettings: Settings,
  currentSettings?: Settings
): Partial<Settings> => {
  const normalized = { ...newSettings } as Record<string, unknown>;

  // Empty password means unchanged in current UI behavior.
  if (!normalized.password) {
    delete normalized.password;
  }
  if (!normalized.visitorPassword) {
    delete normalized.visitorPassword;
  }

  // Backend derives these flags; they are not writable settings.
  delete normalized.isPasswordSet;
  delete normalized.isVisitorPasswordSet;

  if (!currentSettings) {
    // Without a baseline we should not submit a full settings object.
    return {};
  }

  const patchPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized)) {
    const previousValue = (currentSettings as Record<string, unknown>)[key];
    if (!areSettingValuesEqual(value, previousValue)) {
      patchPayload[key] = value;
    }
  }

  return patchPayload as Partial<Settings>;
};

/**
 * Custom hook to manage all settings-related API mutations
 */
export function useSettingsMutations({
  setMessage,
  setInfoModal,
}: UseSettingsMutationsProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: async (newSettings: Settings): Promise<SaveSettingsMutationResult> => {
      let currentSettings = queryClient.getQueryData<Settings>(["settings"]);
      if (!currentSettings) {
        const latestSettings = await api.get("/settings");
        currentSettings = latestSettings.data as Settings;
        queryClient.setQueryData(["settings"], currentSettings);
      }
      const patchPayload = buildSettingsPatchPayload(newSettings, currentSettings);

      if (Object.keys(patchPayload).length === 0) {
        return {
          skipped: true,
          patchPayload,
        };
      }

      await api.patch("/settings", patchPayload);

      return {
        skipped: false,
        patchPayload,
      };
    },
    onSuccess: (result, newSettings) => {
      setMessage({ text: t("settingsSaved"), type: "success" });

      const changedSettings = result?.patchPayload ?? newSettings;
      // Update settings cache immediately so Header and other consumers react without waiting for refetch
      queryClient.setQueryData(["settings"], (old: Settings | undefined) =>
        old ? { ...old, ...changedSettings } : ({ ...newSettings } as Settings)
      );
      // Skip refetch when no fields changed.
      if (!result?.skipped) {
        queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
      if (changedSettings.tags !== undefined) {
        queryClient.invalidateQueries({ queryKey: ["videos"] });
      }
    },
    onError: (error: any) => {
      const msg =
        error?.response?.data?.error ||
        error?.response?.data?.details ||
        error?.message;
      setMessage({
        text: typeof msg === "string" && msg ? msg : t("settingsFailed"),
        type: "error",
      });
    },
  });

  // Migrate data mutation
  const migrateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/settings/migrate");
      return res.data.results;
    },
    onSuccess: (results) => {
      let msg = `${t("migrationReport")}:\n`;
      let hasData = false;

      if (results.warnings && results.warnings.length > 0) {
        msg += `\n⚠️ ${t("migrationWarnings")}:\n${results.warnings.join(
          "\n"
        )}\n`;
      }

      const categories = ["videos", "collections", "settings", "downloads"];
      categories.forEach((cat) => {
        const data = results[cat];
        if (data) {
          if (data.found) {
            msg += `\n✅ ${cat}: ${data.count} ${t("itemsMigrated")}`;
            hasData = true;
          } else {
            msg += `\n❌ ${cat}: ${t("fileNotFound")} ${data.path}`;
          }
        }
      });

      if (results.errors && results.errors.length > 0) {
        msg += `\n\n⛔ ${t("migrationErrors")}:\n${results.errors.join("\n")}`;
      }

      if (!hasData && (!results.errors || results.errors.length === 0)) {
        msg += `\n\n⚠️ ${t("noDataFilesFound")}`;
      }

      setInfoModal({
        isOpen: true,
        title: hasData ? t("migrationResults") : t("migrationNoData"),
        message: msg,
        type: hasData ? "success" : "warning",
      });
    },
    onError: (error: any) => {
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: `${t("migrationFailed")}: ${
          error.response?.data?.details || error.message
        }`,
        type: "error",
      });
    },
  });

  // Cleanup temp files mutation
  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/cleanup-temp-files");
      return res.data;
    },
    onSuccess: (data) => {
      const { deletedCount, errors } = data;
      let msg = t("cleanupTempFilesSuccess").replace(
        "{count}",
        deletedCount.toString()
      );
      if (errors && errors.length > 0) {
        msg += `\n\nErrors:\n${errors.join("\n")}`;
      }

      setInfoModal({
        isOpen: true,
        title: t("success"),
        message: msg,
        type: errors && errors.length > 0 ? "warning" : "success",
      });
    },
    onError: (error: any) => {
      const errorMsg =
        error.response?.data?.error ===
        "Cannot clean up while downloads are active"
          ? t("cleanupTempFilesActiveDownloads")
          : `${t("cleanupTempFilesFailed")}: ${
              error.response?.data?.details || error.message
            }`;

      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: errorMsg,
        type: "error",
      });
    },
  });

  // Delete legacy data mutation
  const deleteLegacyMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/settings/delete-legacy");
      return res.data.results;
    },
    onSuccess: (results) => {
      let msg = `${t("legacyDataDeleted")}\n`;
      if (results.deleted.length > 0) {
        msg += `\nDeleted: ${results.deleted.join(", ")}`;
      }
      if (results.failed.length > 0) {
        msg += `\nFailed: ${results.failed.join(", ")}`;
      }

      setInfoModal({
        isOpen: true,
        title: t("success"),
        message: msg,
        type: "success",
      });
    },
    onError: (error: any) => {
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: `Failed to delete legacy data: ${
          error.response?.data?.details || error.message
        }`,
        type: "error",
      });
    },
  });

  // Format legacy filenames mutation
  const formatFilenamesMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/settings/format-filenames");
      return res.data.results;
    },
    onSuccess: (results) => {
      // Construct message using translations
      let msg = t("formatFilenamesSuccess")
        .replace("{processed}", results.processed.toString())
        .replace("{renamed}", results.renamed.toString())
        .replace("{errors}", results.errors.toString());

      if (results.details && results.details.length > 0) {
        // truncate details if too long
        const detailsToShow = results.details.slice(0, 10);
        msg += `\n\n${t("formatFilenamesDetails")}\n${detailsToShow.join(
          "\n"
        )}`;
        if (results.details.length > 10) {
          msg += `\n${t("formatFilenamesMore").replace(
            "{count}",
            (results.details.length - 10).toString()
          )}`;
        }
      }

      setInfoModal({
        isOpen: true,
        title: t("success"),
        message: msg,
        type: results.errors > 0 ? "warning" : "success",
      });
    },
    onError: (error: any) => {
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: t("formatFilenamesError").replace(
          "{error}",
          error.response?.data?.details || error.message
        ),
        type: "error",
      });
    },
  });

  // Export database mutation
  const exportDatabaseMutation = useMutation({
    mutationFn: async () => {
      const response = await api.get("/settings/export-database", {
        responseType: "blob",
      });
      return response;
    },
    onSuccess: (response) => {
      // Create a blob URL and trigger download
      const blob = new Blob([response.data], {
        type: "application/octet-stream",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // Generate filename with timestamp using helper (same format as backend)
      const timestamp = generateTimestamp();
      const filename = `mytube-backup-${timestamp}.db`;

      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setMessage({ text: t("databaseExportedSuccess"), type: "success" });
    },
    onError: (error: any) => {
      const errorDetails = error.response?.data?.details || error.message;
      setMessage({
        text: `${t("databaseExportFailed")}${
          errorDetails ? `: ${errorDetails}` : ""
        }`,
        type: "error",
      });
    },
  });

  // Import database mutation
  const importDatabaseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await api.post(
        "/settings/import-database",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );
      return response.data;
    },
    onSuccess: () => {
      setInfoModal({
        isOpen: true,
        title: t("success"),
        message: t("databaseImportedSuccess"),
        type: "success",
      });
    },
    onError: (error: any) => {
      const errorDetails = error.response?.data?.details || error.message;
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: `${t("databaseImportFailed")}${
          errorDetails ? `: ${errorDetails}` : ""
        }`,
        type: "error",
      });
    },
  });

  // Cleanup backup databases mutation
  const cleanupBackupDatabasesMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post("/settings/cleanup-backup-databases");
      return response.data;
    },
    onSuccess: (data) => {
      setMessage({
        text: data.message || t("backupDatabasesCleanedUp"),
        type: "success",
      });
    },
    onError: (error: any) => {
      const errorDetails = error.response?.data?.details || error.message;
      setMessage({
        text: `${t("backupDatabasesCleanupFailed")}${
          errorDetails ? `: ${errorDetails}` : ""
        }`,
        type: "error",
      });
    },
  });

  // Get last backup info query
  const { data: lastBackupInfo, refetch: refetchLastBackupInfo } = useQuery({
    queryKey: ["lastBackupInfo"],
    queryFn: async () => {
      const response = await api.get("/settings/last-backup-info");
      return response.data;
    },
    refetchInterval: 60000, // Refetch every 60 seconds (reduced frequency)
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 10 * 60 * 1000, // Garbage collect after 10 minutes
  });

  // Restore from last backup mutation
  const restoreFromLastBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post("/settings/restore-from-last-backup");
      return response.data;
    },
    onSuccess: () => {
      setInfoModal({
        isOpen: true,
        title: t("success"),
        message: t("restoreFromLastBackupSuccess"),
        type: "success",
      });
      // Refetch last backup info after restore
      refetchLastBackupInfo();
    },
    onError: (error: any) => {
      const errorDetails = error.response?.data?.details || error.message;
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: `${t("restoreFromLastBackupFailed")}${
          errorDetails ? `: ${errorDetails}` : ""
        }`,
        type: "error",
      });
    },
  });

  // Rename tag mutation
  const renameTagMutation = useMutation({
    mutationFn: async ({
      oldTag,
      newTag,
    }: {
      oldTag: string;
      newTag: string;
    }) => {
      await api.post("/settings/tags/rename", { oldTag, newTag });
      return { oldTag, newTag };
    },
    onSuccess: () => {
      setMessage({
        text: t("tagRenamedSuccess") || "Tag renamed successfully",
        type: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (error: any) => {
      const apiMsg =
        error?.response?.data?.error ||
        error?.response?.data?.details ||
        error?.message;
      const text =
        typeof apiMsg === "string" && apiMsg
          ? apiMsg
          : t("tagRenameFailed") || "Failed to rename tag";
      setMessage({ text, type: "error" });
    },
  });

  // Computed isSaving state
  const isSaving =
    saveMutation.isPending ||
    migrateMutation.isPending ||
    cleanupMutation.isPending ||
    deleteLegacyMutation.isPending ||
    formatFilenamesMutation.isPending ||
    exportDatabaseMutation.isPending ||
    importDatabaseMutation.isPending ||
    cleanupBackupDatabasesMutation.isPending ||
    restoreFromLastBackupMutation.isPending;

  return {
    saveMutation,
    migrateMutation,
    cleanupMutation,
    deleteLegacyMutation,
    formatFilenamesMutation,
    exportDatabaseMutation,
    importDatabaseMutation,
    cleanupBackupDatabasesMutation,
    restoreFromLastBackupMutation,
    renameTagMutation,
    lastBackupInfo,
    isSaving,
  };
}
