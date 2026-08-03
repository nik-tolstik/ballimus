export interface TelegramWebhookStatus {
  readonly telegramApiAccepted: boolean;
  readonly webhookMatchesExpectedUrl: boolean;
  readonly callbackQueryAllowed: boolean;
  readonly onlyCallbackQueriesAllowed: boolean;
  readonly pendingUpdateCount: number;
  readonly hasLastError: boolean;
}

export interface InspectTelegramWebhookInput {
  readonly botToken: string;
  readonly expectedUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

interface TelegramWebhookInfo {
  readonly url?: unknown;
  readonly allowed_updates?: unknown;
  readonly pending_update_count?: unknown;
  readonly last_error_message?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectedWebhookUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error("Expected webhook URL must be an HTTPS URL without credentials");
  }
  return parsed.toString();
}

function allowedUpdates(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function pendingUpdateCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

export async function inspectTelegramWebhook(
  input: InspectTelegramWebhookInput,
): Promise<TelegramWebhookStatus> {
  const expectedUrl = expectedWebhookUrl(input.expectedUrl);
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const endpoint = new URL(`bot${input.botToken}/getWebhookInfo`, "https://api.telegram.org/");
  const response = await fetchImplementation(endpoint, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Telegram webhook status request failed");

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || payload["ok"] !== true || !isRecord(payload["result"])) {
    throw new Error("Telegram webhook status response was invalid");
  }

  const info = payload["result"] as TelegramWebhookInfo;
  const configuredUpdates = allowedUpdates(info.allowed_updates);
  return {
    telegramApiAccepted: true,
    webhookMatchesExpectedUrl: info.url === expectedUrl,
    callbackQueryAllowed: configuredUpdates.includes("callback_query"),
    onlyCallbackQueriesAllowed: configuredUpdates.length === 1 && configuredUpdates[0] === "callback_query",
    pendingUpdateCount: pendingUpdateCount(info.pending_update_count),
    hasLastError: typeof info.last_error_message === "string" && info.last_error_message.trim() !== "",
  };
}
