import { Alert, Box, CircularProgress, TextField, Typography } from '@mui/material';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { api } from '../utils/apiClient';
import { getApiErrorMessage } from '../utils/errors';
import {
  getFilenameTemplateWarningMessage,
} from './Settings/filenameTemplateShared';
import type { TranslationKey } from '../utils/translations';

/**
 * Validation response from POST /settings/filename-template/validate. Matches
 * the backend controller shape: { valid, errors, warnings, rendered }.
 */
interface ValidateResponse {
  valid: boolean;
  errors: string[];
  warnings: Array<{ code: string; message: string }>;
  rendered: {
    videoPath: string;
    thumbnailPath: string;
    subtitlePath: string;
  } | null;
}

interface ValidationState {
  template: string;
  sourceCollectionType: 'channel' | 'playlist';
  response: ValidateResponse;
}

export interface SubscriptionFilenameTemplateFieldProps {
  /** Current (untrimmed) template value. */
  value: string;
  onChange: (value: string) => void;
  /** Source-collection type used to shape validation warnings and the preview. */
  sourceCollectionType: 'channel' | 'playlist';
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * Notifies the parent when the validity of the (non-empty) input changes, so
   * it can disable its save/subscribe action. Blank input is always considered
   * valid (it means "inherit global"). The parent should disable its action
   * while this is `false`.
   */
  onValidityChange?: (isValid: boolean) => void;
}

const DEBOUNCE_MS = 300;

/**
 * Reusable per-subscription filename-template override field. Renders a
 * multiline monospace editor with debounced server validation, inline error and
 * warning messages, and a rendered example when the template is valid. Blank
 * input means "inherit the global filename naming setting".
 *
 * Client validation is for usability only; the backend remains authoritative.
 */
const SubscriptionFilenameTemplateField: React.FC<
  SubscriptionFilenameTemplateFieldProps
> = ({ value, onChange, sourceCollectionType, disabled, autoFocus, onValidityChange }) => {
  const { t } = useLanguage();
  const [validation, setValidation] = useState<ValidationState | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const requestId = useRef(0);
  const helperTextId = useId();
  const validationMessageId = useId();

  // Blank input is always valid (inherit global). Only non-empty input is sent
  // to the server for validation.
  const trimmed = value.trim();
  const hasTemplate = trimmed.length > 0;
  const validationResponse =
    validation?.template === trimmed &&
    validation.sourceCollectionType === sourceCollectionType
      ? validation.response
      : null;
  const hasErrors = hasTemplate && validationResponse?.valid === false;
  const isInputValid =
    !hasTemplate ||
    (validationResponse?.valid === true && !isValidating);

  // Report validity up to the parent whenever it changes.
  useEffect(() => {
    onValidityChange?.(isInputValid);
  }, [isInputValid, onValidityChange]);

  // Debounced validation request. Cancelled on unmount / value change, and
  // stale responses are ignored via the incrementing requestId.
  useEffect(() => {
    if (!trimmed) {
      // Invalidate an in-flight request before clearing the response. Without
      // this, a late response for a value that was cleared (or retyped) could
      // become the current validation state.
      requestId.current += 1;
      setValidation(null);
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<ValidateResponse>(
          '/settings/filename-template/validate',
          { template: trimmed, sourceCollectionType }
        );
        // Ignore stale responses.
        if (requestId.current !== currentRequestId) return;
        setValidation({
          template: trimmed,
          sourceCollectionType,
          response: res.data,
        });
      } catch (e: unknown) {
        if (requestId.current !== currentRequestId) return;
        setValidation({
          template: trimmed,
          sourceCollectionType,
          response: {
            valid: false,
            errors: [getApiErrorMessage(e) || String(e)],
            warnings: [],
            rendered: null,
          },
        });
      } finally {
        if (requestId.current === currentRequestId) {
          setIsValidating(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, sourceCollectionType]);

  return (
    <Box>
      <TextField
        label={t('subscriptionFilenameTemplate')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        fullWidth
        multiline
        minRows={2}
        maxRows={6}
        spellCheck={false}
        inputMode="text"
        placeholder={t('subscriptionFilenameTemplatePlaceholder')}
        error={hasErrors}
        sx={{ fontFamily: 'monospace' }}
        InputProps={{ style: { fontFamily: 'monospace' } }}
        slotProps={{
          htmlInput: {
            'aria-describedby': hasErrors
              ? `${helperTextId} ${validationMessageId}`
              : helperTextId,
          },
        }}
      />
      <Typography
        id={helperTextId}
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5 }}
      >
        {trimmed
          ? t('subscriptionFilenameTemplateHelp')
          : t('subscriptionFilenameTemplateInherit')}
      </Typography>

      {isValidating && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <CircularProgress size={12} />
          <Typography variant="caption" color="text.secondary">
            {t('filenameValidating')}
          </Typography>
        </Box>
      )}

      {hasErrors && (
        <Alert
          id={validationMessageId}
          severity="error"
          sx={{ mt: 1, whiteSpace: 'pre-wrap' }}
        >
          {validationResponse!.errors.join('\n') || t('filenameValidationError')}
        </Alert>
      )}

      {!hasErrors &&
        validationResponse?.warnings &&
        validationResponse.warnings.length > 0 &&
        validationResponse.warnings.map((warning) => (
          <Alert key={warning.code} severity="warning" sx={{ mt: 1 }}>
            {getFilenameTemplateWarningMessage(
              warning,
              t as (key: TranslationKey) => string
            )}
          </Alert>
        ))}

      {!hasErrors && trimmed && validationResponse?.rendered && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {t('subscriptionFilenameTemplatePreview')}
          </Typography>
          <Typography
            variant="caption"
            sx={{ display: 'block', fontFamily: 'monospace', whiteSpace: 'break-spaces' }}
          >
            {validationResponse.rendered.videoPath}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SubscriptionFilenameTemplateField;
