import {
  DEFAULT_YOUTUBE_PLAYER_CLIENT_EXTRACTOR_ARG,
  DEFAULT_YOUTUBE_REMOTE_COMPONENTS,
  PROVIDER_SCRIPT_ARG_PREFIX,
  YOUTUBE_PLAYER_CLIENT_ARG_PREFIX,
} from "./constants";
import { getProviderScript } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import { isYouTubeUrl } from "../helpers";
import { ytDlpSupportsRemoteComponents } from "./runtime";

function parseExtractorArgParts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseExtractorArgParts(entry));
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function joinExtractorArgParts(parts: string[]): string | undefined {
  const uniqueParts = Array.from(new Set(parts));
  return uniqueParts.length > 0 ? uniqueParts.join(";") : undefined;
}

export function withDefaultYouTubeExtractorArgs(
  url: string,
  flags: Record<string, any>
): Record<string, any> {
  if (!isYouTubeUrl(url)) {
    return flags;
  }

  const providerScript = getProviderScript();
  if (!providerScript) {
    return flags;
  }

  const existingParts = parseExtractorArgParts(flags.extractorArgs);
  const mergedParts = [...existingParts];

  if (
    !existingParts.some((part) => part.startsWith(YOUTUBE_PLAYER_CLIENT_ARG_PREFIX))
  ) {
    mergedParts.push(DEFAULT_YOUTUBE_PLAYER_CLIENT_EXTRACTOR_ARG);
  }

  const providerArg = `${PROVIDER_SCRIPT_ARG_PREFIX}${providerScript}`;
  if (!existingParts.some((part) => part.startsWith(PROVIDER_SCRIPT_ARG_PREFIX))) {
    mergedParts.push(providerArg);
  }

  const extractorArgs = joinExtractorArgParts(mergedParts);

  return {
    ...flags,
    extractorArgs,
  };
}

export async function resolveYouTubeRemoteComponents(
  url: string,
  flags: Record<string, any>
): Promise<Record<string, any>> {
  if (!isYouTubeUrl(url) || !getProviderScript()) {
    return flags;
  }

  const remoteComponentsDisabled =
    flags.noRemoteComponents === true || flags.no_remote_components === true;
  const explicitRemoteComponents =
    flags.remoteComponents ?? flags.remote_components;
  const remoteComponents = remoteComponentsDisabled
    ? explicitRemoteComponents
    : explicitRemoteComponents ?? DEFAULT_YOUTUBE_REMOTE_COMPONENTS;

  if (remoteComponents === undefined) {
    return flags;
  }

  if (!(await ytDlpSupportsRemoteComponents())) {
    const {
      remoteComponents: _remoteComponents,
      remote_components: _remote_components,
      ...rest
    } = flags;
    return rest;
  }

  return {
    ...flags,
    remoteComponents,
  };
}
