/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosRequestConfig } from "axios";
import api, {
  apiClient,
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
  it("passes through request config and rejects request errors", async () => {
    const handlers = (apiClient.interceptors.request as any).handlers;
    const onFulfilled = handlers?.[0]?.fulfilled as
      | ((config: AxiosRequestConfig) => AxiosRequestConfig)
      | undefined;
    const onRejected = handlers?.[0]?.rejected as
      | ((error: Error) => Promise<never>)
      | undefined;

    expect(onFulfilled).toBeTypeOf("function");
    expect(onRejected).toBeTypeOf("function");

    const config = { url: "/videos" } as AxiosRequestConfig;
    expect(onFulfilled!(config)).toBe(config);

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
