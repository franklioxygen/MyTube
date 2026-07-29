import path from "path";
import {
  AuthorOrganizationMode,
  resolveAuthorOrganizationMode,
} from "../../types/settings";
import { sanitizePathSegment } from "../../utils/security";
import { TemplateWarning } from "./types";

export interface OrganizationContext {
  mode?: AuthorOrganizationMode | string;
  author?: string | null;
}

function normalizePathSegmentForCompare(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function applyPhysicalOrganization(
  renderedRelativePath: string,
  context: OrganizationContext
): { relativePath: string; warnings: TemplateWarning[] } {
  const mode = resolveAuthorOrganizationMode({
    authorOrganizationMode:
      context.mode === "root" ||
      context.mode === "author_folder_only" ||
      context.mode === "author_collection_linked"
        ? context.mode
        : undefined,
  });

  if (mode !== "author_folder_only") {
    return { relativePath: renderedRelativePath, warnings: [] };
  }

  const sanitizedAuthor =
    typeof context.author === "string"
      ? sanitizePathSegment(context.author.trim())
      : "";

  if (!sanitizedAuthor) {
    return {
      relativePath: renderedRelativePath,
      warnings: [
        {
          code: "unresolved_author",
          message:
            "Author folder organization was requested, but no usable author name was available.",
        },
      ],
    };
  }

  const normalizedRelative = renderedRelativePath.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/").find(Boolean) || "";
  if (
    firstSegment &&
    normalizePathSegmentForCompare(firstSegment) ===
      normalizePathSegmentForCompare(sanitizedAuthor)
  ) {
    return { relativePath: normalizedRelative, warnings: [] };
  }

  return {
    relativePath: path.posix.join(sanitizedAuthor, normalizedRelative),
    warnings: [],
  };
}
