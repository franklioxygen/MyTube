import path from "path";

export function isLikelyGenericCaptureFilename(filename: string): boolean {
  const baseName = path.parse(filename).name.trim();
  if (!baseName) {
    return false;
  }

  const upperBaseName = baseName.toUpperCase();

  if (
    ["IMG", "VID", "MOV"].some((prefix) => {
      if (!upperBaseName.startsWith(prefix)) {
        return false;
      }
      const suffix = baseName.slice(prefix.length).replace(/^[._-]?/, "");
      return /^\d{3,}$/i.test(suffix);
    })
  ) {
    return true;
  }

  if (upperBaseName.startsWith("DSC")) {
    const suffix = baseName.slice(3).replace(/^[A-Z]?[._-]?/i, "");
    if (/^\d{3,}$/i.test(suffix)) {
      return true;
    }
  }

  if (upperBaseName.startsWith("PXL_") || upperBaseName.startsWith("PXL-")) {
    const separator = upperBaseName[3];
    const parts = baseName.split(separator);
    if (parts.length >= 3) {
      const datePart = parts[1] ?? "";
      const timeAndSuffix = parts[2] ?? "";
      const [timePart, ...suffixParts] = timeAndSuffix.split(".");
      const suffix = suffixParts.join(".");
      if (
        /^\d{8}$/.test(datePart) &&
        /^\d{6,}$/.test(timePart) &&
        (suffix.length === 0 || /^[A-Z0-9_]+$/i.test(suffix))
      ) {
        return true;
      }
    }
  }

  if (
    upperBaseName.startsWith("SCREENSHOT") ||
    upperBaseName.startsWith("SCREENRECORDING") ||
    upperBaseName.startsWith("SCREEN")
  ) {
    const suffix = baseName
      .replace(/^SCREEN(?:SHOT|RECORDING)?/i, "")
      .replace(/^[._-]?/, "");
    if (/^\d{3,}$/i.test(suffix)) {
      return true;
    }
  }

  return false;
}
