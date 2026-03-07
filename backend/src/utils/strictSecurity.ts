import { isStrictSecurityModel } from "../config/securityModel";

export type StrictDisabledFeature =
  | "hooks"
  | "ytDlpConfig"
  | "mountDirectories"
  | "cloudflaredControl";

const FEATURE_LABELS: Record<StrictDisabledFeature, string> = {
  hooks: "task hooks",
  ytDlpConfig: "yt-dlp text configuration",
  mountDirectories: "mount directories API write",
  cloudflaredControl: "cloudflared in-app control",
};

/**
 * Strict mode currently applies one global deny policy to the full high-risk
 * control plane. The optional feature argument keeps call sites explicit and
 * leaves room for future per-feature policy without another API break.
 */
export const isStrictFeatureDisabled = (
  _feature?: StrictDisabledFeature
): boolean => isStrictSecurityModel();

export const createStrictFeatureDisabledPayload = (
  feature: StrictDisabledFeature
): {
  success: false;
  error: string;
  feature: StrictDisabledFeature;
} => ({
  success: false,
  error: `feature disabled: ${FEATURE_LABELS[feature]} is disabled in strict security model`,
  feature,
});
