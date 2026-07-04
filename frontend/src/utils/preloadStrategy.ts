import { isAndroid, isIOS, isSafari } from "./playerUtils";

/**
 * Decides the `<video preload>` value for the player.
 *
 * Extracted from `VideoElement.tsx` so it can be unit-tested (and so the
 * component file only exports components, keeping Fast Refresh working).
 */

type NetworkInformationLike = {
  effectiveType?: string;
  saveData?: boolean;
};

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
};

type PreloadStrategyInput = {
  src?: string | null;
  mediaPath?: string | null;
};

const hasWebMExtension = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }

  const withoutQuery = value.trim().split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  return withoutQuery.endsWith(".webm");
};

const isWebMSource = ({ src, mediaPath }: PreloadStrategyInput): boolean =>
  hasWebMExtension(mediaPath) || hasWebMExtension(src);

export const computePreloadStrategy = ({
  src = null,
  mediaPath = null,
}: PreloadStrategyInput = {}): "auto" | "metadata" | "none" => {
  const navigatorWithConnection = navigator as NavigatorWithConnection;
  const connection =
    navigatorWithConnection.connection ||
    navigatorWithConnection.mozConnection ||
    navigatorWithConnection.webkitConnection;

  if (connection) {
    const type = connection.effectiveType; // 'slow-2g', '2g', '3g', '4g'
    const saveData = connection.saveData;

    if (saveData) {
      return "none"; // Save data mode -> minimal loading
    }
    if (type === "4g") {
      return "auto"; // Good connection -> auto preload
    }
    return "metadata"; // Slower connection -> metadata only
  }

  // Browsers without the Network Information API (Safari, Firefox).
  // Mobile devices stay conservative to avoid burning cellular data;
  // isIOS() also catches iPadOS, whose Safari reports a desktop Mac UA.
  if (isIOS() || isAndroid()) {
    return "metadata";
  }

  // Desktop Safari gets 'auto' only for WebM: read-ahead buffering is
  // what makes timeline seeks land in already-buffered data, and
  // Safari's native WebM pipeline downloads linearly. Other formats and
  // browsers keep their long-standing 'metadata' behavior.
  return isSafari() && isWebMSource({ src, mediaPath }) ? "auto" : "metadata";
};
