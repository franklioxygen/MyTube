import {
  FastForward,
  FastRewind,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  KeyboardDoubleArrowLeft,
  KeyboardDoubleArrowRight,
} from "@mui/icons-material";
import { Box, IconButton, Tooltip } from "@mui/material";
import type { ElementType } from "react";
import { useLanguage } from "../../../contexts/LanguageContext";
import {
  formatCompactSeekDuration,
  formatSeekDuration,
} from "../../../utils/playerSeekIntervals";

export type SeekDirection = "backward" | "forward";
export type SeekTier = "short" | "medium" | "long";

interface SeekButtonProps {
  direction: SeekDirection;
  tier: SeekTier;
  seconds: number;
  onSeek: (deltaSeconds: number) => void;
  disableTooltip: boolean;
}

const SEEK_ICONS: Record<SeekTier, Record<SeekDirection, ElementType>> = {
  short: {
    backward: KeyboardArrowLeft,
    forward: KeyboardArrowRight,
  },
  medium: {
    backward: FastRewind,
    forward: FastForward,
  },
  long: {
    backward: KeyboardDoubleArrowLeft,
    forward: KeyboardDoubleArrowRight,
  },
};

export default function SeekButton({
  direction,
  tier,
  seconds,
  onSeek,
  disableTooltip,
}: SeekButtonProps) {
  const { t } = useLanguage();
  const Icon = SEEK_ICONS[tier][direction];
  const duration = formatSeekDuration(seconds, t);
  const accessibleLabel = t(
    direction === "backward" ? "seekBackwardBy" : "seekForwardBy",
    { duration }
  );
  const deltaSeconds = direction === "backward" ? -seconds : seconds;

  return (
    <Tooltip title={accessibleLabel} disableHoverListener={disableTooltip}>
      <IconButton
        onClick={() => onSeek(deltaSeconds)}
        aria-label={accessibleLabel}
        size="small"
        sx={{
          width: 44,
          height: 44,
          p: 0.5,
          flexDirection: "column",
          gap: 0,
        }}
      >
        <Icon aria-hidden="true" sx={{ fontSize: 21 }} />
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            fontSize: "0.625rem",
            fontWeight: 700,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {formatCompactSeekDuration(seconds)}
        </Box>
      </IconButton>
    </Tooltip>
  );
}
