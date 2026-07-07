import type { TranslationKey } from "./translations";

/**
 * Download format preset options backed by the defaultVideoCodec setting.
 * Labels are translated via locale keys (e.g. defaultVideoCodec_av1) in frontend/src/utils/locales/.
 */
export const VIDEO_CODEC_OPTIONS: {
  value: string;
  labelKey: TranslationKey;
}[] = [
  { value: "h264", labelKey: "defaultVideoCodec_h264" },
  { value: "vp9", labelKey: "defaultVideoCodec_vp9" },
  { value: "h265", labelKey: "defaultVideoCodec_h265" },
  { value: "av1", labelKey: "defaultVideoCodec_av1" },
];

export const VIDEO_CONTAINER_OPTIONS: {
  value: "auto" | "mp4" | "webm" | "mkv";
  labelKey: TranslationKey;
}[] = [
  { value: "auto", labelKey: "preferredVideoContainer_auto" },
  { value: "mp4", labelKey: "preferredVideoContainer_mp4" },
  { value: "webm", labelKey: "preferredVideoContainer_webm" },
  { value: "mkv", labelKey: "preferredVideoContainer_mkv" },
];
