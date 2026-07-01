import { Settings } from "../../types/settings";
import { logger } from "../../utils/logger";

const hasOwnSetting = (
  settings: Partial<Settings>,
  key: keyof Settings
): boolean => Object.prototype.hasOwnProperty.call(settings, key);

const getDeletedTags = (oldTags: string[], newTags: string[]): string[] =>
  oldTags.filter((old) => !newTags.some((n) => n.toLowerCase() === old.toLowerCase()));

const getRenamedTagPairs = (
  oldTags: string[],
  newTags: string[]
): [string, string][] => {
  const renamedPairs: [string, string][] = [];
  for (const oldTag of oldTags) {
    const newTag = newTags.find((n) => n.toLowerCase() === oldTag.toLowerCase());
    if (newTag !== undefined && newTag !== oldTag) {
      renamedPairs.push([oldTag, newTag]);
    }
  }
  return renamedPairs;
};

const applyTagMutations = (
  renamedPairs: [string, string][],
  deletedTags: string[]
): void => {
  import("../../services/tagService")
    .then(({ deleteTagsFromVideos, renameTag: renameTagFn }) => {
      for (const [oldTag, newTag] of renamedPairs) {
        renameTagFn(oldTag, newTag);
      }
      if (deletedTags.length > 0) {
        deleteTagsFromVideos(deletedTags);
      }
    })
    .catch((err) => {
      logger.error("Error processing tag deletions/renames:", err);
    });
};

export const processTagChanges = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): void => {
  if (
    !hasOwnSetting(settingsToPersist, "tags") ||
    !Array.isArray(settingsToPersist.tags)
  ) {
    return;
  }

  const oldTags = Array.isArray(existingSettings.tags)
    ? (existingSettings.tags as string[])
    : [];
  const newTags = settingsToPersist.tags as string[];
  const deletedTags = getDeletedTags(oldTags, newTags);
  const renamedPairs = getRenamedTagPairs(oldTags, newTags);

  if (deletedTags.length === 0 && renamedPairs.length === 0) {
    return;
  }

  applyTagMutations(renamedPairs, deletedTags);
};
