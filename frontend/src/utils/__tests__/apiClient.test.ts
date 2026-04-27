import { describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosRequestConfig } from "axios";
import api, {
  apiClient,
  ensureCsrfToken,
  fetchWithCsrf,
  getApiErrorMessage,
  getErrorMessage,
  getWaitTime,
  isAuthError,
  isRateLimitError,
} from "../apiClient";

const makeAxiosLikeError = (payload: {
  status?: number;
  data?: any;
  url?: string;
  message?: string;
  withRequest?: boolean;
}): AxiosError =>
  ({
    isAxiosError: true,
    message: payload.message ?? "Axios error",
    config: { url: payload.url ?? "/endpoint" },
    response:
      payload.status !== undefined
        ? { status: payload.status, data: payload.data } as any
        : undefined,
    request: payload.withRequest ? {} : undefined,
  } as AxiosError);

describe("apiClient helpers", () => {
  it("extracts best error message for different error shapes", () => {
    expect(
      getErrorMessage(
        makeAxiosLikeError({
          status: 400,
          data: { error: "validation failed" },
        })
      )
    ).toBe("validation failed");

    expect(
      getErrorMessage(
        makeAxiosLikeError({
          status: 400,
          data: { message: "bad request" },
        })
      )
    ).toBe("bad request");

    expect(getErrorMessage(makeAxiosLikeError({ message: "network down" }))).toBe(
      "network down"
    );
    expect(getErrorMessage(new Error("native error"))).toBe("native error");
    expect(getErrorMessage("unknown")).toBe("An unknown error occurred");
  });

  it("translates errorKey values before falling back to raw messages", async () => {
    const t = (key: string) =>
      key === "settingsAuthRequired" ? "Please sign in first." : key;

    await expect(
      getApiErrorMessage(
        makeAxiosLikeError({
          status: 401,
          data: {
            errorKey: "settingsAuthRequired",
            error: "Authentication required. Please log in to access this resource.",
          },
        }),
        t
      )
    ).resolves.toBe("Please sign in first.");

    await expect(
      getApiErrorMessage(
        makeAxiosLikeError({
          status: 401,
          data: {
            errorKey: "settingsAuthRequired",
            error: "Authentication required. Please log in to access this resource.",
          },
        }),
        (key: string) => key
      )
    ).resolves.toBe(
      "Authentication required. Please log in to access this resource."
    );
  });

  it("parses JSON error payloads returned as blobs", async () => {
    const errorBlob = {
      constructor: { name: "Blob" },
      text: async () =>
        JSON.stringify({
          errorKey: "settingsVisitorAccessRestricted",
          error: "Visitor role: Access to this resource is restricted.",
        }),
    };

    await expect(
      getApiErrorMessage(
        makeAxiosLikeError({
          status: 403,
          data: errorBlob,
        }),
        (key: string) =>
          key === "settingsVisitorAccessRestricted"
            ? "Localized visitor restriction"
            : key
      )
    ).resolves.toBe("Localized visitor restriction");
  });

  it("keeps plain objects with non-callable text fields as regular API payloads", async () => {
    await expect(
      getApiErrorMessage(
        makeAxiosLikeError({
          status: 400,
          data: {
            text: "plain text field",
            error: "validation failed",
          },
        })
      )
    ).resolves.toBe("validation failed");
  });

  it("extracts rate-limit wait time", () => {
    expect(
      getWaitTime(makeAxiosLikeError({ status: 429, data: { waitTime: 42 } }))
    ).toBe(42);
    expect(getWaitTime(makeAxiosLikeError({ status: 429 }))).toBe(0);
    expect(getWaitTime(new Error("x"))).toBe(0);
  });

  it("detects auth and rate-limit errors", () => {
    expect(isRateLimitError(makeAxiosLikeError({ status: 429 }))).toBe(true);
    expect(isRateLimitError(makeAxiosLikeError({ status: 500 }))).toBe(false);
    expect(isRateLimitError(new Error("x"))).toBe(false);

    expect(isAuthError(makeAxiosLikeError({ status: 401 }))).toBe(true);
    expect(isAuthError(makeAxiosLikeError({ status: 403 }))).toBe(false);
    expect(isAuthError(new Error("x"))).toBe(false);
  });
});

describe("api wrappers", () => {
  it("fetches password status when CSRF refresh is requested", async () => {
    const getSpy = vi.spyOn(apiClient, "get").mockResolvedValue({ data: {} } as any);

    await ensureCsrfToken({ refresh: true });

    expect(getSpy).toHaveBeenCalledWith("/settings/password-enabled", {
      timeout: 5000,
    });
    getSpy.mockRestore();
  });

  it("fetches with CSRF token and included credentials for streaming requests", async () => {
    const responseHandlers = (apiClient.interceptors.response as any).handlers;
    const onResponseFulfilled = responseHandlers?.[0]?.fulfilled as
      | ((response: any) => any)
      | undefined;
    onResponseFulfilled!({ headers: { "x-csrf-token": "csrf-fetch-123" } });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    await fetchWithCsrf("/cloud/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [request] = fetchSpy.mock.calls[0] as [Request];

    expect(request).toBeInstanceOf(Request);
    expect(new URL(request.url).pathname).toBe("/api/cloud/sync");
    expect(request.method).toBe("POST");
    expect(request.credentials).toBe("include");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(request.headers.get("X-CSRF-Token")).toBe("csrf-fetch-123");

    fetchSpy.mockRestore();
  });

  it("rejects absolute URLs in fetchWithCsrf", async () => {
    await expect(
      fetchWithCsrf("https://example.com/api/cloud/sync", { method: "POST" })
    ).rejects.toThrow("API path must be a same-origin relative path");
  });

  it("forwards GET calls with and without config", async () => {
    const getSpy = vi.spyOn(apiClient, "get").mockResolvedValue({ data: {} } as any);
    const config: AxiosRequestConfig = { params: { q: "x" } };

    await api.get("/videos");
    await api.get("/videos", config);

    expect(getSpy).toHaveBeenNthCalledWith(1, "/videos");
    expect(getSpy).toHaveBeenNthCalledWith(2, "/videos", config);
    getSpy.mockRestore();
  });

  it("forwards POST calls for all argument shapes", async () => {
    const postSpy = vi.spyOn(apiClient, "post").mockResolvedValue({ data: {} } as any);
    const config: AxiosRequestConfig = { headers: { "X-Test": "1" } };

    await api.post("/videos", { title: "t" }, config);
    await api.post("/videos", { title: "t" });
    await api.post("/videos");

    expect(postSpy).toHaveBeenNthCalledWith(1, "/videos", { title: "t" }, config);
    expect(postSpy).toHaveBeenNthCalledWith(2, "/videos", { title: "t" });
    expect(postSpy).toHaveBeenNthCalledWith(3, "/videos");
    postSpy.mockRestore();
  });

  it("forwards PUT calls for all argument shapes", async () => {
    const putSpy = vi.spyOn(apiClient, "put").mockResolvedValue({ data: {} } as any);
    const config: AxiosRequestConfig = { headers: { "X-Test": "1" } };

    await api.put("/videos/1", { title: "t" }, config);
    await api.put("/videos/1", { title: "t" });
    await api.put("/videos/1");

    expect(putSpy).toHaveBeenNthCalledWith(1, "/videos/1", { title: "t" }, config);
    expect(putSpy).toHaveBeenNthCalledWith(2, "/videos/1", { title: "t" });
    expect(putSpy).toHaveBeenNthCalledWith(3, "/videos/1");
    putSpy.mockRestore();
  });

  it("forwards PATCH calls for all argument shapes", async () => {
    const patchSpy = vi.spyOn(apiClient, "patch").mockResolvedValue({ data: {} } as any);
    const config: AxiosRequestConfig = { headers: { "X-Test": "1" } };

    await api.patch("/videos/1", { title: "t" }, config);
    await api.patch("/videos/1", { title: "t" });
    await api.patch("/videos/1");

    expect(patchSpy).toHaveBeenNthCalledWith(1, "/videos/1", { title: "t" }, config);
    expect(patchSpy).toHaveBeenNthCalledWith(2, "/videos/1", { title: "t" });
    expect(patchSpy).toHaveBeenNthCalledWith(3, "/videos/1");
    patchSpy.mockRestore();
  });

  it("forwards DELETE calls with and without config", async () => {
    const deleteSpy = vi
      .spyOn(apiClient, "delete")
      .mockResolvedValue({ data: {} } as any);
    const config: AxiosRequestConfig = { headers: { "X-Test": "1" } };

    await api.delete("/videos/1");
    await api.delete("/videos/1", config);

    expect(deleteSpy).toHaveBeenNthCalledWith(1, "/videos/1");
    expect(deleteSpy).toHaveBeenNthCalledWith(2, "/videos/1", config);
    deleteSpy.mockRestore();
  });
});

describe("api interceptors", () => {
  it("attaches the latest CSRF token to request config and rejects request errors", async () => {
    const responseHandlers = (apiClient.interceptors.response as any).handlers;
    const onResponseFulfilled = responseHandlers?.[0]?.fulfilled as
      | ((response: any) => any)
      | undefined;
    onResponseFulfilled!({ headers: { "x-csrf-token": "csrf-123" } });

    const handlers = (apiClient.interceptors.request as any).handlers;
    const onFulfilled = handlers?.[0]?.fulfilled as
      | ((config: AxiosRequestConfig) => AxiosRequestConfig)
      | undefined;
    const onRejected = handlers?.[0]?.rejected as
      | ((error: Error) => Promise<never>)
      | undefined;

    expect(onFulfilled).toBeTypeOf("function");
    expect(onRejected).toBeTypeOf("function");

    const config = { url: "/videos", headers: {} } as AxiosRequestConfig;
    expect(onFulfilled!(config)).toBe(config);
    expect(config.headers).toEqual({ "X-CSRF-Token": "csrf-123" });

    const error = new Error("request failed");
    await expect(onRejected!(error)).rejects.toBe(error);
  });

  it("handles response error categories and rethrows", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = (apiClient.interceptors.response as any).handlers;
    const onRejected = handlers?.[0]?.rejected as
      | ((error: AxiosError) => Promise<never>)
      | undefined;

    expect(onRejected).toBeTypeOf("function");

    const samples = [
      makeAxiosLikeError({ status: 401, url: "/auth" }),
      makeAxiosLikeError({ status: 403, url: "/forbidden" }),
      makeAxiosLikeError({ status: 404, url: "/not-found" }),
      makeAxiosLikeError({ status: 429, url: "/rate" }),
      makeAxiosLikeError({ status: 500, url: "/server", data: { msg: "boom" } }),
      makeAxiosLikeError({ url: "/network", withRequest: true }),
      makeAxiosLikeError({ message: "setup failed" }),
    ];

    for (const error of samples) {
      await expect(onRejected!(error)).rejects.toBe(error);
    }

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
