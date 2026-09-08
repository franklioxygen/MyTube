import path from "path";
import type { Video } from "../storageService/types";
import { planMediaServerExportPaths } from "./pathPlanner";

const key = (value: string) => path.normalize(value).normalize("NFKC").toLowerCase();

/** Reconcile fresh owners, but only plan paths for new or moved records.
 * A retention sweep consequently plans the library once, not once per delete.
 * Entries removed from the library are evicted, keeping memory bounded by it.
 */
export class ArtifactReferenceIndex {
  private rows = new Map<string, { videoPath: unknown; artifacts: string[] }>();
  private counts = new Map<string, number>();

  update(videos: Video[], excludedId: string): void {
    const remaining = new Map(videos.filter((video) => video.id !== excludedId).map((video) => [video.id, video]));
    for (const [id, previous] of this.rows) {
      if (remaining.has(id) && remaining.get(id)!.videoPath === previous.videoPath) continue;
      for (const artifact of previous.artifacts) {
        const count = this.counts.get(artifact)! - 1;
        if (count) this.counts.set(artifact, count);
        else this.counts.delete(artifact);
      }
      this.rows.delete(id);
    }
    for (const [id, video] of remaining) {
      if (this.rows.has(id)) continue;
      const plan = planMediaServerExportPaths(video);
      const artifacts = plan ? [...new Set([
        plan.episodeNfoAbsolutePath, plan.episodeSourceJsonAbsolutePath,
        plan.episodeThumbAliasAbsolutePath, ...plan.showPosterAbsolutePaths,
        ...(plan.showNfoAbsolutePath ? [plan.showNfoAbsolutePath] : []),
      ].map(key))] : [];
      for (const artifact of artifacts) this.counts.set(artifact, (this.counts.get(artifact) ?? 0) + 1);
      this.rows.set(id, { videoPath: video.videoPath, artifacts });
    }
  }

  has(absolutePath: string): boolean { return this.counts.has(key(absolutePath)); }
}
