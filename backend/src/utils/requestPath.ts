import { Request } from "express";

export const getNormalizedRequestPath = (req: Request): string => {
  const rawPath =
    typeof req.path === "string" && req.path.length > 0
      ? req.path
      : req.url || "";

  const [pathname] = rawPath.split("?");
  return pathname || "/";
};

export const matchesExactPath = (
  req: Request,
  allowedPaths: readonly string[]
): boolean => {
  const requestPath = getNormalizedRequestPath(req);
  return allowedPaths.includes(requestPath);
};

export const matchesPathOrSubpath = (
  req: Request,
  allowedPaths: readonly string[]
): boolean => {
  const requestPath = getNormalizedRequestPath(req);

  return allowedPaths.some((allowedPath) => {
    if (allowedPath === "/") {
      return requestPath === "/";
    }

    return (
      requestPath === allowedPath ||
      requestPath.startsWith(`${allowedPath}/`)
    );
  });
};
