import crypto from "crypto";

const RELEASE_ID_PATTERN = /^[A-Za-z0-9._-]{8,96}$/;
const OPERATION_ID_PATTERN = /^op-[a-f0-9]{16,32}$/;
const INSTANCE_ID_PATTERN = /^[0-9]+-[a-f0-9]{8,16}$/;
const LEASE_FILENAME_PATTERN = /^[0-9]+-[a-f0-9]{8,16}-[a-f0-9]{16}\.json$/;
const HEX_ID_PATTERN = /^[a-f0-9]{16,32}$/;

export function isValidReleaseId(value: string): boolean {
  return RELEASE_ID_PATTERN.test(value);
}

export function isValidOperationId(value: string): boolean {
  return OPERATION_ID_PATTERN.test(value);
}

export function isValidInstanceId(value: string): boolean {
  return INSTANCE_ID_PATTERN.test(value);
}

export function isValidLeaseFilename(value: string): boolean {
  return LEASE_FILENAME_PATTERN.test(value);
}

export function isValidHexNonce(value: string): boolean {
  return HEX_ID_PATTERN.test(value);
}

export function createOperationId(): string {
  return `op-${crypto.randomBytes(10).toString("hex")}`;
}

export function createNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createInstanceId(pid: number = process.pid): string {
  return `${pid}-${crypto.randomBytes(6).toString("hex")}`;
}

export function createLeaseFilename(
  instanceId: string,
  leaseId: string
): string {
  return `${instanceId}-${leaseId}.json`;
}

export function isValidLeaseId(value: string): boolean {
  return /^[a-f0-9]{16}$/.test(value);
}

export function createLeaseId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function createReleaseId(version: string): string {
  const safeVersion = version
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomBytes(8).toString("hex");
  const releaseId = `${safeVersion || "ytdlp"}-${suffix}`;
  if (!isValidReleaseId(releaseId)) {
    return `ytdlp-${suffix}`;
  }
  return releaseId;
}

export function createTempBasename(prefix: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9._-]+/g, "");
  return `.${safePrefix || "tmp"}.${crypto.randomBytes(8).toString("hex")}.tmp`;
}
