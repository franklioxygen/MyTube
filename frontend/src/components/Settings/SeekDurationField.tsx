import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  SEEK_DURATION_UNIT_SECONDS,
  SeekDurationUnit,
  isValidPlayerSeekSeconds,
  toSeekDurationEditorValue,
} from "../../utils/playerSeekIntervals";

interface SeekDurationFieldProps {
  id: string;
  label: string;
  seconds: number;
  resetToken: number;
  onSecondsChange: (seconds: number) => void;
  onValidityChange: (valid: boolean) => void;
}

const WHOLE_POSITIVE_NUMBER_PATTERN = /^[1-9]\d*$/;

function getDraftSeconds(
  amountText: string,
  unit: SeekDurationUnit
): number | null {
  if (!WHOLE_POSITIVE_NUMBER_PATTERN.test(amountText)) {
    return null;
  }

  const amount = Number(amountText);
  const seconds = amount * SEEK_DURATION_UNIT_SECONDS[unit];
  return isValidPlayerSeekSeconds(seconds) ? seconds : null;
}

export default function SeekDurationField({
  id,
  label,
  seconds,
  resetToken,
  onSecondsChange,
  onValidityChange,
}: SeekDurationFieldProps) {
  const { t } = useLanguage();
  const initialEditorValue = useMemo(
    () => toSeekDurationEditorValue(seconds),
    [seconds]
  );
  const [amountText, setAmountText] = useState(String(initialEditorValue.amount));
  const [unit, setUnit] = useState<SeekDurationUnit>(initialEditorValue.unit);
  const [isFocused, setIsFocused] = useState(false);
  const previousResetTokenRef = useRef(resetToken);
  const draftSeconds = getDraftSeconds(amountText, unit);
  const isValid = draftSeconds !== null;

  useEffect(() => {
    onValidityChange(isValid);
  }, [isValid, onValidityChange]);

  useEffect(() => {
    const resetRequested = previousResetTokenRef.current !== resetToken;
    previousResetTokenRef.current = resetToken;

    if (!resetRequested && (isFocused || draftSeconds === seconds)) {
      return;
    }

    const next = toSeekDurationEditorValue(seconds);
    setAmountText(String(next.amount));
    setUnit(next.unit);
  }, [draftSeconds, isFocused, resetToken, seconds]);

  const updateDraft = (nextAmountText: string, nextUnit: SeekDurationUnit) => {
    const nextSeconds = getDraftSeconds(nextAmountText, nextUnit);
    if (nextSeconds !== null) {
      onSecondsChange(nextSeconds);
    }
  };

  const handleAmountChange = (value: string) => {
    setAmountText(value);
    updateDraft(value, unit);
  };

  const handleUnitChange = (nextUnit: SeekDurationUnit) => {
    setUnit(nextUnit);
    updateDraft(amountText, nextUnit);
  };

  const unitLabelId = `${id}-unit-label`;
  const errorId = `${id}-error`;

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <TextField
        id={id}
        label={label}
        value={amountText}
        type="number"
        error={!isValid}
        helperText={!isValid ? t("seekIntervalRangeError") : " "}
        onChange={(event) => handleAmountChange(event.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        slotProps={{
          formHelperText: { id: errorId },
          htmlInput: {
            min: 1,
            step: 1,
            inputMode: "numeric",
            "aria-describedby": !isValid ? errorId : undefined,
          },
        }}
        sx={{ flex: 1, minWidth: 0 }}
      />
      <FormControl sx={{ minWidth: { xs: 116, sm: 128 } }}>
        <InputLabel id={unitLabelId}>{t("seekDurationUnit")}</InputLabel>
        <Select
          labelId={unitLabelId}
          value={unit}
          label={t("seekDurationUnit")}
          inputProps={{
            "aria-label": `${label}: ${t("seekDurationUnit")}`,
          }}
          onChange={(event) =>
            handleUnitChange(event.target.value as SeekDurationUnit)
          }
        >
          <MenuItem value="seconds">{t("seekUnitSeconds")}</MenuItem>
          <MenuItem value="minutes">{t("seekUnitMinutes")}</MenuItem>
          <MenuItem value="hours">{t("seekUnitHours")}</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
}
