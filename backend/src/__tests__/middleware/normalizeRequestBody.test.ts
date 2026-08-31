import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { normalizeRequestBody } from "../../middleware/normalizeRequestBody";

describe("normalizeRequestBody", () => {
  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(normalizeRequestBody);

    // Mirrors how handlers across the API read the body, e.g.
    // downloadController's `const { url } = req.body;`.
    app.post("/echo", (req, res) => {
      const { url } = req.body;
      res.json({ url: url ?? null });
    });

    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        res.status(500).json({ error: err.message });
      }
    );

    return app;
  };

  it("should give handlers an empty body when the request carries none", async () => {
    const response = await request(buildApp()).post("/echo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: null });
  });

  it("should give handlers an empty body for a content type no parser claims", async () => {
    const response = await request(buildApp())
      .post("/echo")
      .type("text")
      .send("not json");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: null });
  });

  it("should leave a parsed JSON body untouched", async () => {
    const response = await request(buildApp())
      .post("/echo")
      .send({ url: "https://example.com/video" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://example.com/video" });
  });

  it("should leave a parsed urlencoded body untouched", async () => {
    const response = await request(buildApp())
      .post("/echo")
      .type("form")
      .send("url=https%3A%2F%2Fexample.com%2Fvideo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://example.com/video" });
  });
});
