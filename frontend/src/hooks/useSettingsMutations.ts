import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "../contexts/LanguageContext";
import { Settings } from "../types";
import { api, getApiErrorData, getApiErrorMessage } from "../utils/apiClient";
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

type SettingsPatchInput = Settings & {
  authenticatedRole?: string;
};

interface MigrationCategoryResult {
  found: boolean;
  count: number;
  path: string;
}

interface MigrationResults {
  warnings?: string[];
  errors?: string[];
  videos?: MigrationCategoryResult;
  collections?: MigrationCategoryResult;
  settings?: MigrationCategoryResult;
  downloads?: MigrationCategoryResult;
}

export interface MergePreviewSummary {
  videos: { merged: number; skipped: number };
  collections: { merged: number; skipped: number };
  collectionLinks: { merged: number; skipped: number };
  subscriptions: { merged: number; skipped: number };
  downloadHistory: { merged: number; skipped: number };
  videoDownloads: { merged: number; skipped: number };
  tags: { merged: number; skipped: number };
}

const areSettingValuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }

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

const normalizeSettingsPatchInput = (
  newSettings: SettingsPatchInput,
): Partial<Settings> => {
  const {
    password,
    visitorPassword,
    isPasswordSet: _isPasswordSet,
    isVisitorPasswordSet: _isVisitorPasswordSet,
    deploymentSecurity: _deploymentSecurity,
    authenticatedRole: _authenticatedRole,
    ...rest
  } = newSettings;
  const normalized: Partial<Settings> = { ...rest };

  // Empty password means unchanged in current UI behavior.
  if (password) {
    normalized.password = password;
  }
  if (visitorPassword) {
    normalized.visitorPassword = visitorPassword;
  }

  const normalizedEntries = Object.entries(normalized) as Array<
    [keyof Settings, Settings[keyof Settings] | undefined]
  >;

  return Object.fromEntries(
    normalizedEntries.flatMap(([key, value]) =>
      typeof value === "undefined" ? [] : ([[key, value]] as const),
    ),
  ) as Partial<Settings>;
};

const buildSettingsPatchPayload = (
  newSettings: SettingsPatchInput,
  currentSettings?: Settings,
): Partial<Settings> => {
  if (!currentSettings) {
    return {};
  }

  const normalized = normalizeSettingsPatchInput(newSettings);
  const currentValues = new Map(
    Object.entries(currentSettings) as Array<[string, unknown]>,
  );

  return Object.fromEntries(
    (Object.entries(normalized) as Array<[string, unknown]>).filter(
      ([key, value]) => !areSettingValuesEqual(value, currentValues.get(key)),
    ),
  ) as Partial<Settings>;
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

  const invalidateDatabaseQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
    void queryClient.invalidateQueries({ queryKey: ["videos"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
    void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    void queryClient.invalidateQueries({ queryKey: ["subscriptionTasks"] });
    void queryClient.invalidateQueries({ queryKey: ["downloadHistory"] });
  };

  const formatErrorText = (fallback: string, detail?: string) =>
    detail ? `${fallback}: ${detail}` : fallback;

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

      const changedSettings = result.patchPayload;
      // Update settings cache immediately so Header and other consumers react without waiting for refetch
      queryClient.setQueryData(["settings"], (old: Settings | undefined) =>
        old ? { ...old, ...changedSettings } : ({ ...newSettings } as Settings)
      );
      // Skip refetch when no fields changed.
      if (!result.skipped) {
        void queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
      if (changedSettings.tags !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ["videos"] });
      }
    },
    onError: async (error: unknown) => {
      const msg = await getApiErrorMessage(error, t);
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
    onSuccess: (results: MigrationResults) => {
      const warnings = results.warnings ?? [];
      const errors = results.errors ?? [];
      const hasErrors = errors.length > 0;
      let msg = `${t("migrationReport")}:\n`;
      let hasData = false;

      if (warnings.length > 0) {
        msg += `\n⚠️ ${t("migrationWarnings")}:\n${warnings.join(
          "\n"
        )}\n`;
      }

      const appendCategoryResult = (
        category: string,
        data?: MigrationCategoryResult,
      ) => {
        if (data) {
          if (data.found) {
            msg += `\n✅ ${category}: ${data.count} ${t("itemsMigrated")}`;
            hasData = true;
          } else {
            msg += `\n❌ ${category}: ${t("fileNotFound")} ${data.path}`;
          }
        }
      };

      appendCategoryResult("videos", results.videos);
      appendCategoryResult("collections", results.collections);
      appendCategoryResult("settings", results.settings);
      appendCategoryResult("downloads", results.downloads);

      if (hasErrors) {
        msg += `\n\n⛔ ${t("migrationErrors")}:\n${errors.join("\n")}`;
      }

      if (!hasData && !hasErrors) {
        msg += `\n\n⚠️ ${t("noDataFilesFound")}`;
      }

      setInfoModal({
        isOpen: true,
        title: hasData ? t("migrationResults") : t("migrationNoData"),
        message: msg,
        type: hasData ? "success" : "warning",
      });
    },
    onError: async (error: unknown) => {
      const detail = await getApiErrorMessage(error, t);
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: formatErrorText(t("migrationFailed"), detail),
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
    onError: async (error: unknown) => {
      const errorData = await getApiErrorData(error);
      const errorMsg =
        errorData?.error ===
        "Cannot clean up while downloads are active"
          ? t("cleanupTempFilesActiveDownloads")
          : formatErrorText(
              t("cleanupTempFilesFailed"),
              await getApiErrorMessage(error, t)
            );

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
    onError: async (error: unknown) => {
      const detail = await getApiErrorMessage(error, t);
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: formatErrorText(t("legacyDataDeleteFailed"), detail),
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
    onError: async (error: unknown) => {
      const detail = await getApiErrorMessage(error, t);
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: t("formatFilenamesError").replace(
          "{error}",
          detail || t("error")
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
    onError: async (error: unknown) => {
      const errorDetails = await getApiErrorMessage(error, t);
      setMessage({
        text: formatErrorText(t("databaseExportFailed"), errorDetails),
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
    onError: async (error: unknown) => {
      const errorDetails = await getApiErrorMessage(error, t);
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: formatErrorText(t("databaseImportFailed"), errorDetails),
        type: "error",
      });
    },
  });

  // Merge database mutation
  const previewMergeDatabaseMutation = useMutation({
    mutationFn: async (file: File): Promise<MergePreviewSummary> => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await api.post(
        "/settings/merge-database-preview",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );
      return response.data.summary;
    },
  });

  // Merge database mutation
  const mergeDatabaseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await api.post(
        "/settings/merge-database",
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
        message: t("databaseMergedSuccess"),
        type: "success",
      });
      invalidateDatabaseQueries();
      void refetchLastBackupInfo();
    },
    onError: async (error: unknown) => {
      const errorDetails = await getApiErrorMessage(error, t);
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: formatErrorText(t("databaseMergeFailed"), errorDetails),
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
    onError: async (error: unknown) => {
      const errorDetails = await getApiErrorMessage(error, t);
      setMessage({
        text: formatErrorText(t("backupDatabasesCleanupFailed"), errorDetails),
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
      void refetchLastBackupInfo();
    },
    onError: async (error: unknown) => {
      const errorDetails = await getApiErrorMessage(error, t);
      setInfoModal({
        isOpen: true,
        title: t("error"),
        message: formatErrorText(t("restoreFromLastBackupFailed"), errorDetails),
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
    onError: async (error: unknown) => {
      const apiMsg = await getApiErrorMessage(error, t);
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
    mergeDatabaseMutation.isPending ||
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
    previewMergeDatabaseMutation,
    mergeDatabaseMutation,
    cleanupBackupDatabasesMutation,
    restoreFromLastBackupMutation,
    renameTagMutation,
    lastBackupInfo,
    isSaving,
  };
}
