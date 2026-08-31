import { NextFunction, Request, Response } from "express";

// body-parser 2 (Express 5) leaves req.body undefined when a request carries no
// body, or a content type no mounted parser claims; body-parser 1 set it to {}.
// Handlers across the API destructure req.body directly, so without this a
// bodyless or mistyped request throws a TypeError and surfaces as a 500 instead
// of the route's own 400 validation response.
export function normalizeRequestBody(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.body === undefined) {
    req.body = {};
  }

  next();
}
