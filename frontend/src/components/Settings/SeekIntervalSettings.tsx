import { Alert, Box, Button, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  DEFAULT_PLAYER_SEEK_INTERVALS,
  PlayerSeekIntervals,
  arePlayerSeekIntervalsOrdered,
} from "../../utils/playerSeekIntervals";
import SeekDurationField from "./SeekDurationField";

type SeekSettingKey =
  | "playerSeekShortSeconds"
  | "playerSeekMediumSeconds"
  | "playerSeekLongSeconds";

interface SeekIntervalSettingsProps {
  intervals: PlayerSeekIntervals;
  onChange: (field: SeekSettingKey, value: number) => void;
  onValidityChange: (valid: boolean) => void;
}

type FieldValidity = Record<"short" | "medium" | "long", boolean>;

const INITIAL_FIELD_VALIDITY: FieldValidity = {
  short: true,
  medium: true,
  long: true,
};

export default function SeekIntervalSettings({
  intervals,
  onChange,
  onValidityChange,
}: SeekIntervalSettingsProps) {
  const { t } = useLanguage();
  const [fieldValidity, setFieldValidity] = useState<FieldValidity>(
    INITIAL_FIELD_VALIDITY
  );
  const [resetToken, setResetToken] = useState(0);
  const ordered = arePlayerSeekIntervalsOrdered(intervals);
  const allFieldsValid = Object.values(fieldValidity).every(Boolean);
  const valid = allFieldsValid && ordered;

  useEffect(() => {
    onValidityChange(valid);
  }, [onValidityChange, valid]);

  const updateFieldValidity = useCallback(
    (field: keyof FieldValidity, fieldValid: boolean) => {
      setFieldValidity((current) =>
        current[field] === fieldValid
          ? current
          : { ...current, [field]: fieldValid }
      );
    },
    []
  );

  const handleReset = () => {
    setFieldValidity(INITIAL_FIELD_VALIDITY);
    onChange(
      "playerSeekShortSeconds",
      DEFAULT_PLAYER_SEEK_INTERVALS.shortSeconds
    );
    onChange(
      "playerSeekMediumSeconds",
      DEFAULT_PLAYER_SEEK_INTERVALS.mediumSeconds
    );
    onChange(
      "playerSeekLongSeconds",
      DEFAULT_PLAYER_SEEK_INTERVALS.longSeconds
    );
    setResetToken((current) => current + 1);
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        {t("seekControls")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("seekControlsDescription")}
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        <SeekDurationField
          id="player-seek-short"
          label={t("seekShortInterval")}
          seconds={intervals.shortSeconds}
          resetToken={resetToken}
          onSecondsChange={(value) =>
            onChange("playerSeekShortSeconds", value)
          }
          onValidityChange={(fieldValid) =>
            updateFieldValidity("short", fieldValid)
          }
        />
        <SeekDurationField
          id="player-seek-medium"
          label={t("seekMediumInterval")}
          seconds={intervals.mediumSeconds}
          resetToken={resetToken}
          onSecondsChange={(value) =>
            onChange("playerSeekMediumSeconds", value)
          }
          onValidityChange={(fieldValid) =>
            updateFieldValidity("medium", fieldValid)
          }
        />
        <SeekDurationField
          id="player-seek-long"
          label={t("seekLongInterval")}
          seconds={intervals.longSeconds}
          resetToken={resetToken}
          onSecondsChange={(value) => onChange("playerSeekLongSeconds", value)}
          onValidityChange={(fieldValid) =>
            updateFieldValidity("long", fieldValid)
          }
        />
      </Box>

      {allFieldsValid && !ordered && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {t("seekIntervalOrderError")}
        </Alert>
      )}

      <Button variant="text" onClick={handleReset} sx={{ mt: 1 }}>
        {t("resetSeekIntervals")}
      </Button>
    </Box>
  );
}
