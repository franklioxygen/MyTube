import { logger } from "../../logger";
import { assertLockOwnership, withPublishLock } from "./lock";
import {
  decidePublication,
  readCurrentManifest,
  readReleaseManifest,
  removePublishedManifest,
  writeCurrentManifest,
  writePublishedManifest,
} from "./manifests";
import fs from "fs";
import {
  ensureManagedStoreLayout,
  getGenerationClaimPath,
  getManagedStoreLayout,
  readClaim,
  readClaimToken,
  removeGenerationClaim,
  statMtimeMs,
  writeJsonExclusive,
} from "./paths";
import { createNonce } from "./ids";
import { YT_DLP_PUBLISH_LOCK_STALE_MS } from "../constants";
import type {
  CurrentManifest,
  ManagedStoreLayout,
  PublishOutcome,
} from "./types";

/**
 * Atomically reserve a generation number. Returns false when another publisher
 * already owns it, which is the signal to abandon this publication.
 */
function claimGeneration(
  layout: ManagedStoreLayout,
  next: CurrentManifest
): string | null {
  const claimPath = getGenerationClaimPath(layout, next.generation);
  const token = createNonce();
  const claim = {
    releaseId: next.releaseId,
    claimedAt: next.publishedAt,
    token,
  };
  try {
    writeJsonExclusive(claimPath, claim);
    return token;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  // A claim exists. A publisher that merely failed removes its own, so this is
  // either one still in flight or one whose process died mid-publication.
  // Leaving it would reject every future update forever, since they all compute
  // the same next generation. Age separates the two cases: nothing legitimately
  // sits between claiming and committing for longer than a stale lock.
  const claimedAt = statMtimeMs(claimPath);
  if (claimedAt === null || Date.now() - claimedAt < YT_DLP_PUBLISH_LOCK_STALE_MS) {
    return null;
  }
  logger.warn(
    `[yt-dlp] Reclaiming abandoned generation ${next.generation} claim after ${Math.round(
      (Date.now() - claimedAt) / 1000
    )}s`
  );
  // Move it aside rather than delete it. A rename is atomic, so exactly one
  // process can take a given claim out of the way; a concurrent reclaimer's
  // rename fails and it retries against whatever now exists. Deleting instead
  // would let a slow reclaimer remove a replacement's fresh claim.
  const observedToken = readClaimToken(claimPath);
  if (!retireAbandonedClaim(layout, next.generation, token, observedToken)) {
    return null;
  }
  try {
    writeJsonExclusive(claimPath, claim);
    return token;
  } catch {
    return null;
  }
}

function retireAbandonedClaim(
  layout: ManagedStoreLayout,
  generation: number,
  token: string,
  observedToken: string | null
): boolean {
  const claimPath = getGenerationClaimPath(layout, generation);
  const retiredPath = `${claimPath}.${token}.abandoned`;
  try {
    fs.renameSync(claimPath, retiredPath);
  } catch {
    // Somebody else moved it first; they own the reclamation.
    return false;
  }

  // The rename is atomic about *who* moves the path, not about *what* was
  // sitting there: a reclaimer paused after observing the expired claim could
  // have moved a replacement that appeared meanwhile. Identify what we took by
  // its token rather than its timestamp - a replacement written within the
  // filesystem's timestamp resolution would otherwise look like the claim we
  // judged - and put it back if it is not the one.
  const retired = readClaim(retiredPath);
  if (retired.token !== observedToken) {
    try {
      fs.renameSync(retiredPath, claimPath);
    } catch {
      // Best effort; a lost claim is reclaimed by age on the next attempt.
    }
    return false;
  }

  // A publisher that died between recording its publication and moving the
  // pointer left a published.json behind. Freeing its generation without
  // removing that record would leave two releases claiming the same
  // generation, and both recovery and the rollback window order by generation.
  // The claim names the release, so this is exactly the record to drop.
  if (retired.releaseId) {
    removePublishedManifest(layout.root, retired.releaseId);
  }

  try {
    fs.unlinkSync(retiredPath);
  } catch {
    // Harmless: it is no longer at the claim path.
  }
  return true;
}

export async function publishValidatedRelease(input: {
  releaseId: string;
  version: string;
  generationAtInstallStart: number | null;
  currentIsUsable?: boolean;
}): Promise<PublishOutcome> {
  const layout = ensureManagedStoreLayout(getManagedStoreLayout());
  return withPublishLock(async (lock) => {
    // Re-read under the lock: another publisher may have moved current on
    // while this candidate was being installed and validated.
    const current = readCurrentManifest(layout.root);
    const currentVersion = current
      ? readReleaseManifest(current.releaseId, layout.root)?.version ?? null
      : null;
    const decision = decidePublication({
      current,
      currentVersion,
      candidateVersion: input.version,
      candidateReleaseId: input.releaseId,
      generationAtInstallStart: input.generationAtInstallStart,
      currentIsUsable: input.currentIsUsable,
    });
    if (decision.action === "reject") {
      if (decision.kind === "conflict") {
        throw new Error(
          `Refusing to publish yt-dlp release: ${decision.reason}`
        );
      }
      // Already up to date. The candidate directory stays behind for GC; the
      // operator gets a successful "no change" result rather than an error.
      logger.info(
        `[yt-dlp] Keeping the current managed release: ${decision.reason}`
      );
      return { current, published: false, reason: decision.reason };
    }
    // A suspended publisher whose stale lock was recovered must abort rather
    // than resume and overwrite a newer generation.
    assertLockOwnership(lock);
    const next: CurrentManifest = {
      schemaVersion: 1,
      generation: decision.generation,
      releaseId: input.releaseId,
      previousReleaseId: decision.previousReleaseId,
      publishedAt: new Date().toISOString(),
    };
    // Record the accepted publication before moving the pointer. If the
    // pointer write is interrupted, corruption recovery may safely finish the
    // accepted transition. Conflict-rejected finalized candidates never get
    // this record and therefore cannot be mistaken for published releases.
    // Claim the generation before anything else. Exclusive file creation is
    // the one primitive the filesystem gives us that is genuinely atomic
    // across processes, so this turns the pointer update from check-then-write
    // into a compare-and-swap: two publishers racing from the same current.json
    // compute the same generation, and exactly one of them can create it. A
    // publisher descheduled past the stale window therefore cannot resume and
    // overwrite a newer generation - the winner already owns the number.
    const claimToken = claimGeneration(layout, next);
    if (!claimToken) {
      throw new Error(
        `Refusing to publish yt-dlp release: generation ${next.generation} was claimed by another publisher`
      );
    }
    let committed = false;
    try {
      writePublishedManifest(layout.root, next);
      // Belt and braces: the lock should still be ours, and losing it means
      // something is badly wrong even though the claim above already fenced us.
      assertLockOwnership(lock);
      writeCurrentManifest(layout.root, next);
      committed = true;
    } finally {
      if (!committed) {
        // Nothing moved the pointer, so undo both marks. Leaving the record
        // would let recovery promote a transition that never committed, and
        // leaving the claim would reject every later update at this generation.
        //
        // Order matters: only free the generation once its record is actually
        // gone. A record that could not be deleted - a transient Windows
        // sharing violation, say - plus a freed generation would let the next
        // update reuse it and leave two releases recording the same one. The
        // claim then expires and its age-based reclamation retries the record.
        if (removePublishedManifest(layout.root, next.releaseId)) {
          removeGenerationClaim(layout, next.generation, claimToken);
        } else {
          logger.warn(
            `[yt-dlp] Kept the generation ${next.generation} claim: its publication record could not be removed`
          );
        }
      }
    }
    logger.info(
      `[yt-dlp] Published managed release ${input.releaseId} (${input.version}) as generation ${next.generation}`
    );
    return { current: next, published: true };
  });
}
