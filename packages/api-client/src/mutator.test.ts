import axios, { AxiosHeaders, type RawAxiosHeaders } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiClientError,
  configureApiClient,
  customInstance,
  getErrorCode,
  normalizeApiError,
  shouldRetryRequest,
} from "./mutator.js";

afterEach(() => {
  vi.restoreAllMocks();
  configureApiClient({ apiBaseUrl: "", telegramInitData: "" });
});

describe("customInstance", () => {
  it("adds the Mini App auth and mutation headers while applying the API base URL", async () => {
    const request = vi.spyOn(axios, "request").mockResolvedValue({ data: { ok: true } } as never);
    configureApiClient({
      apiBaseUrl: "https://api.example.test/",
      telegramInitData: "query_id=123",
    });

    await customInstance({ url: "/v1/matches", method: "POST" });

    const requestConfig = request.mock.calls[0]?.[0];
    const headers = AxiosHeaders.from(requestConfig?.headers as unknown as RawAxiosHeaders | undefined);
    expect(requestConfig?.baseURL).toBe("https://api.example.test");
    expect(headers.get("X-Telegram-Init-Data")).toBe("query_id=123");
    expect(headers.get("Idempotency-Key")).toEqual(expect.any(String));
  });

  it("preserves explicit If-Match and Idempotency-Key values", async () => {
    const request = vi.spyOn(axios, "request").mockResolvedValue({ data: { ok: true } } as never);

    await customInstance({
      url: "/v1/matches/1",
      method: "PATCH",
      headers: { "If-Match": "3", "Idempotency-Key": "fixed-key" },
    });

    const headers = AxiosHeaders.from(
      request.mock.calls[0]?.[0]?.headers as unknown as RawAxiosHeaders | undefined,
    );
    expect(headers.get("If-Match")).toBe("3");
    expect(headers.get("Idempotency-Key")).toBe("fixed-key");
  });
});

describe("API errors", () => {
  it("normalizes REST error payloads", () => {
    const error = Object.assign(new Error("fallback"), {
      isAxiosError: true,
      code: "ERR_BAD_REQUEST",
      response: {
        status: 409,
        data: {
          code: "MATCH_VERSION_STALE",
          message: "Reload the match.",
          details: { expectedVersion: 3 },
        },
        headers: {},
      },
    });

    const normalized = normalizeApiError(error);
    expect(normalized).toBeInstanceOf(ApiClientError);
    expect(normalized.status).toBe(409);
    expect(normalized.code).toBe("MATCH_VERSION_STALE");
    expect(normalized.details).toEqual({ expectedVersion: 3 });
    expect(normalized.message).toBe("Reload the match.");
    expect(getErrorCode(normalized)).toBe("MATCH_VERSION_STALE");
  });

  it("never retries authentication failures", () => {
    expect(shouldRetryRequest(0, new ApiClientError("Unauthorized", 401, undefined, undefined, undefined))).toBe(false);
    expect(shouldRetryRequest(0, new ApiClientError("Forbidden", 403, undefined, undefined, undefined))).toBe(false);
    expect(shouldRetryRequest(0, new Error("temporary"))).toBe(true);
    expect(shouldRetryRequest(2, new Error("temporary"))).toBe(false);
  });
});
