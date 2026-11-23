import { beforeEach, expect, it, vi } from "vitest";

const rewriteAutoTagsForAliases = vi.hoisted(() => vi.fn());
vi.mock("../../services/tagService", () => ({ rewriteAutoTagsForAliases }));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));

import { processTagAliasChanges } from "../../controllers/settingsController/tagMutations";

beforeEach(() => {
  rewriteAutoTagsForAliases.mockClear();
});

it("rewrites stored suggestions for added and retargeted aliases only", async () => {
  await processTagAliasChanges(
    { tagAliases: { song: "music", tune: "music", old: "x" } } as any,
    { tagAliases: { song: "音乐", tune: "music", fresh: "live" } }
  );
  expect(rewriteAutoTagsForAliases).toHaveBeenCalledTimes(1);
  expect(rewriteAutoTagsForAliases).toHaveBeenCalledWith(["song", "fresh"]);
});

it("does nothing when the save leaves aliases out or unchanged", async () => {
  await processTagAliasChanges({ tagAliases: { song: "music" } } as any, { tags: ["a"] });
  await processTagAliasChanges({ tagAliases: { song: "music" } } as any, {
    tagAliases: { song: "music" },
  });
  await processTagAliasChanges({ tagAliases: { song: "music" } } as any, { tagAliases: {} });
  expect(rewriteAutoTagsForAliases).not.toHaveBeenCalled();
});
