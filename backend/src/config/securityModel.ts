export type SecurityModel = "strict" | "legacy";

export const SECURITY_MODEL_ENV_KEY = "SECURITY_MODEL";
export const DEFAULT_SECURITY_MODEL: SecurityModel = "legacy";

const VALID_SECURITY_MODELS: ReadonlySet<SecurityModel> = new Set([
  "strict",
  "legacy",
]);

interface ResolveSecurityModelOptions {
  rawSecurityModel?: string | undefined;
  nodeEnv?: string | undefined;
  defaultModel?: SecurityModel;
}

const normalizeEnvValue = (value: string | undefined): string =>
  (value ?? "").trim().toLowerCase();

function parseSecurityModel(
  rawSecurityModel: string | undefined
): SecurityModel | null {
  const normalized = normalizeEnvValue(rawSecurityModel);
  if (VALID_SECURITY_MODELS.has(normalized as SecurityModel)) {
    return normalized as SecurityModel;
  }

  return null;
}

export const resolveSecurityModel = (
  options: ResolveSecurityModelOptions = {}
): SecurityModel => {
  const defaultModel = options.defaultModel ?? DEFAULT_SECURITY_MODEL;
  const rawSecurityModel =
    options.rawSecurityModel ?? process.env[SECURITY_MODEL_ENV_KEY];

  return parseSecurityModel(rawSecurityModel) ?? defaultModel;
};

export const assertSecurityModelConfiguration = (
  options: ResolveSecurityModelOptions = {}
): SecurityModel => {
  const rawSecurityModel =
    options.rawSecurityModel ?? process.env[SECURITY_MODEL_ENV_KEY];
  const parsed = parseSecurityModel(rawSecurityModel);
  const nodeEnv = normalizeEnvValue(options.nodeEnv ?? process.env.NODE_ENV);
  const isProduction = nodeEnv === "production";

  if (isProduction && parsed === null) {
    const envValueDisplay =
      rawSecurityModel === undefined || rawSecurityModel.trim().length === 0
        ? "missing"
        : `invalid value "${rawSecurityModel}"`;
    throw new Error(
      `${SECURITY_MODEL_ENV_KEY} is ${envValueDisplay}. ` +
        `Set ${SECURITY_MODEL_ENV_KEY}=strict or ${SECURITY_MODEL_ENV_KEY}=legacy before starting in production.`
    );
  }

  return parsed ?? (options.defaultModel ?? DEFAULT_SECURITY_MODEL);
};

export const isStrictSecurityModel = (
  options: ResolveSecurityModelOptions = {}
): boolean => assertSecurityModelConfiguration(options) === "strict";
