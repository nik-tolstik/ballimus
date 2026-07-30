import axios, { AxiosHeaders, type AxiosRequestConfig, type RawAxiosHeaders } from "axios";

export interface ApiClientRuntimeConfig {
  readonly apiBaseUrl?: string;
  readonly telegramInitData?: string | (() => string | undefined);
}

export interface NormalizedApiError {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly message: string;
  readonly details: unknown;
  readonly requestId: string | undefined;
}

interface RuntimeGlobal {
  readonly Telegram?: {
    readonly WebApp?: {
      readonly initData?: unknown;
    };
  };
  readonly __FOOTBALL_API_BASE_URL__?: unknown;
  readonly __VITE_API_BASE_URL__?: unknown;
}

interface ImportMetaWithEnv extends ImportMeta {
  readonly env?: {
    readonly API_BASE_URL?: unknown;
    readonly VITE_API_BASE_URL?: unknown;
  };
}

interface ErrorPayload {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
}

const runtimeGlobal = globalThis as typeof globalThis & RuntimeGlobal;
let runtimeConfig: ApiClientRuntimeConfig = {};
const generatedIdempotencyKeys = new WeakMap<object, string>();

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

function importMetaEnvironment(): ImportMetaWithEnv["env"] {
  return (import.meta as ImportMetaWithEnv).env;
}

export function configureApiClient(config: ApiClientRuntimeConfig): void {
  runtimeConfig = { ...runtimeConfig, ...config };
}

export function getApiBaseUrl(): string {
  const environment = importMetaEnvironment();
  const value =
    runtimeConfig.apiBaseUrl ??
    stringValue(runtimeGlobal.__FOOTBALL_API_BASE_URL__) ??
    stringValue(runtimeGlobal.__VITE_API_BASE_URL__) ??
    stringValue(environment?.VITE_API_BASE_URL) ??
    stringValue(environment?.API_BASE_URL);

  return value === undefined ? "" : stripTrailingSlashes(value);
}

export function getTelegramInitData(): string | undefined {
  const configured = runtimeConfig.telegramInitData;
  if (typeof configured === "function") return stringValue(configured());
  if (configured !== undefined) return stringValue(configured);

  return stringValue(runtimeGlobal.Telegram?.WebApp?.initData);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPayloadMessage(payload: ErrorPayload | undefined, fallback: string): string {
  if (typeof payload?.message === "string" && payload.message.length > 0) return payload.message;
  if (Array.isArray(payload?.message)) {
    const messages = payload.message.filter((item): item is string => typeof item === "string");
    if (messages.length > 0) return messages.join("; ");
  }
  return fallback.length > 0 ? fallback : "Request failed.";
}

function getHeaderValue(headers: AxiosHeaders | undefined, name: string): string | undefined {
  return stringValue(headers?.get(name));
}

function getPayloadStatus(payload: ErrorPayload | undefined): number | undefined {
  const value = payload?.status ?? payload?.statusCode;
  return typeof value === "number" ? value : undefined;
}

export class ApiClientError extends Error implements NormalizedApiError {
  public override readonly name = "ApiClientError";

  public constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly code: string | undefined,
    public readonly details: unknown,
    public readonly requestId: string | undefined,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function normalizeApiError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;

  if (axios.isAxiosError(error)) {
    const payload = isRecord(error.response?.data)
      ? (error.response.data as ErrorPayload)
      : undefined;
    const status = error.response?.status ?? getPayloadStatus(payload);
    const responseHeaders = AxiosHeaders.from(
      error.response?.headers as unknown as RawAxiosHeaders | undefined,
    );
    const code = stringValue(payload?.code) ?? stringValue(error.code);
    const details = payload?.details ?? (payload === undefined ? error.response?.data : undefined);

    return new ApiClientError(
      getPayloadMessage(payload, error.message),
      status,
      code,
      details,
      getHeaderValue(responseHeaders, "x-request-id"),
      error,
    );
  }

  if (error instanceof Error) {
    return new ApiClientError(error.message, undefined, undefined, undefined, undefined, error);
  }

  return new ApiClientError("Request failed.", undefined, undefined, error, undefined, error);
}

export function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiClientError) return error.status;
  if (axios.isAxiosError(error)) return error.response?.status;
  if (isRecord(error)) {
    const status = error["status"] ?? error["statusCode"];
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiClientError) return error.code;
  if (axios.isAxiosError(error) && isRecord(error.response?.data)) {
    return stringValue(error.response.data["code"]);
  }
  if (isRecord(error)) return stringValue(error["code"]);
  return undefined;
}

export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) return false;
  return failureCount < 2;
}

function isVersionedApiRequest(url: string | undefined, baseURL: string): boolean {
  if (url === undefined) return false;

  try {
    const parsed = new URL(url, baseURL || "http://football-api.invalid");
    return parsed.pathname === "/v1" || parsed.pathname.startsWith("/v1/");
  } catch {
    return url === "/v1" || url.startsWith("/v1/");
  }
}

function isMutation(method: string | undefined): boolean {
  const normalizedMethod = method?.toUpperCase() ?? "GET";
  return normalizedMethod !== "GET" && normalizedMethod !== "HEAD" && normalizedMethod !== "OPTIONS";
}

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `football-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getRequestId(config: AxiosRequestConfig, options: AxiosRequestConfig | undefined): object {
  if (options !== undefined) return options;
  return config;
}

function mergeHeaders(config: AxiosRequestConfig, options: AxiosRequestConfig | undefined): AxiosHeaders {
  const headers = new AxiosHeaders();
  const copyHeaders = (source: AxiosRequestConfig["headers"] | undefined): void => {
    if (source === undefined) return;
    const normalized = AxiosHeaders.from(source as unknown as RawAxiosHeaders);
    for (const [name, value] of normalized) headers.set(name, value);
  };

  copyHeaders(config.headers);
  copyHeaders(options?.headers);
  return headers;
}

function addRuntimeHeaders(
  config: AxiosRequestConfig,
  options: AxiosRequestConfig | undefined,
  baseURL: string,
): AxiosRequestConfig {
  const headers = mergeHeaders(config, options);
  const url = options?.url ?? config.url;

  if (isVersionedApiRequest(url, baseURL)) {
    const initData = getTelegramInitData();
    if (initData !== undefined && getHeaderValue(headers, "X-Telegram-Init-Data") === undefined) {
      headers.set("X-Telegram-Init-Data", initData);
    }

    if (isMutation(options?.method ?? config.method)) {
      const requestId = getRequestId(config, options);
      const idempotencyKey =
        getHeaderValue(headers, "Idempotency-Key") ??
        generatedIdempotencyKeys.get(requestId) ??
        createIdempotencyKey();
      generatedIdempotencyKeys.set(requestId, idempotencyKey);
      headers.set("Idempotency-Key", idempotencyKey);
    }

    const ifMatch = getHeaderValue(headers, "If-Match");
    if (ifMatch !== undefined) headers.set("If-Match", ifMatch);
  }

  return { ...config, ...options, headers };
}

export function customInstance<T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> & { cancel?: () => void } {
  const baseURL = options?.baseURL ?? config.baseURL ?? getApiBaseUrl();
  const requestConfig = addRuntimeHeaders(config, options, baseURL);
  if (baseURL !== "") requestConfig.baseURL = baseURL;

  const source = axios.CancelToken.source();
  const request = axios.request<T>({ ...requestConfig, cancelToken: source.token });
  const promise = request
    .then((response) => response.data)
    .catch((error: unknown) => {
      throw normalizeApiError(error);
    }) as Promise<T> & { cancel?: () => void };

  promise.cancel = () => source.cancel("Query cancelled");
  return promise;
}
