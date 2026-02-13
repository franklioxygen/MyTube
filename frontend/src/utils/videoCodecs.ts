import type { TranslationKey } from "./translations";

/**
 * Video codec options for download settings.
 * Labels are translated via locale keys (e.g. defaultVideoCodec_av1) in frontend/src/utils/locales/.
 */
export const VIDEO_CODEC_OPTIONS: {
  value: string;
  labelKey: TranslationKey;
}[] = [
  { value: "h264", labelKey: "defaultVideoCodec_h264" },
  { value: "h265", labelKey: "defaultVideoCodec_h265" },
  { value: "av1", labelKey: "defaultVideoCodec_av1" },
  { value: "vp9", labelKey: "defaultVideoCodec_vp9" },
];
