import { beforeEach, expect, it, vi } from "vitest";

const rewriteAutoTagsForAliases = vi.hoisted(() => vi.fn());
vi.mock("../../services/tagService", () => ({ rewriteAutoTagsForAliases }));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));

import { processTagAliasChanges } from "../../controllers/settingsController/tagMutations";

beforeEach(() => {
  rewriteAutoTagsForAliases.mockClear();
});

it("rewrites stored suggestions for added and retargeted aliases only", async () => {
  processTagAliasChanges(
    { tagAliases: { song: "music", tune: "music", old: "x" } } as any,
    { tagAliases: { song: "音乐", tune: "music", fresh: "live" } }
  );
  await vi.waitFor(() => expect(rewriteAutoTagsForAliases).toHaveBeenCalledTimes(1));
  expect(rewriteAutoTagsForAliases).toHaveBeenCalledWith(["song", "fresh"]);
});

it("does nothing when the save leaves aliases out or unchanged", async () => {
  processTagAliasChanges({ tagAliases: { song: "music" } } as any, { tags: ["a"] });
  processTagAliasChanges({ tagAliases: { song: "music" } } as any, {
    tagAliases: { song: "music" },
  });
  processTagAliasChanges({ tagAliases: { song: "music" } } as any, { tagAliases: {} });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(rewriteAutoTagsForAliases).not.toHaveBeenCalled();
});
