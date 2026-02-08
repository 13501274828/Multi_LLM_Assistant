import {
  ChatCompletionParams,
  ModelProvider,
  ModelResponse,
  ModelUsage
} from "../types";

const defaultBaseUrl = "https://openrouter.ai/api/v1";

type OpenRouterChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
};

type OpenRouterContent = string | Array<{ type?: string; text?: string }> | undefined;

type OpenRouterResponse = {
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export class OpenRouterHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string, message?: string) {
    super(message ?? `OpenRouter request failed (${status}): ${responseBody.slice(0, 400)}`);
    this.name = "OpenRouterHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

function toUsage(raw: OpenRouterResponse["usage"]): ModelUsage | undefined {
  if (!raw) {
    return undefined;
  }

  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens
  };
}

function normalizeContent(content: OpenRouterContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((chunk) => chunk.text ?? "")
    .filter((item) => item.length > 0)
    .join("\n");
}

function mustGetEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function normalizeApiKey(raw: string): string {
  let key = raw.trim();

  // Accept accidental "Bearer xxx" paste in .env.
  if (/^Bearer\s+/i.test(key)) {
    key = key.replace(/^Bearer\s+/i, "");
  }

  // Common typo: first letter uppercase.
  if (key.startsWith("Sk-or-v1-")) {
    key = `s${key.slice(1)}`;
  }

  return key;
}

export class OpenRouterProvider implements ModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly referer?: string;
  private readonly appTitle?: string;

  constructor() {
    this.apiKey = normalizeApiKey(mustGetEnv("OPENROUTER_API_KEY"));
    this.baseUrl = process.env.OPENROUTER_BASE_URL?.trim() || defaultBaseUrl;
    this.referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
    this.appTitle = process.env.OPENROUTER_X_TITLE?.trim();

    if (this.apiKey.startsWith("http")) {
      throw new Error(
        "OPENROUTER_API_KEY looks like a URL. Please set it to an API key (starts with sk-or-v1-)."
      );
    }
  }

  async chatCompletion(params: ChatCompletionParams): Promise<ModelResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };

    if (this.referer) {
      headers["HTTP-Referer"] = this.referer;
    }

    if (this.appTitle) {
      headers["X-Title"] = this.appTitle;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new OpenRouterHttpError(response.status, errorBody);
    }

    const data = (await response.json()) as OpenRouterResponse;
    const content = normalizeContent(data.choices?.[0]?.message?.content);

    return {
      content,
      model: data.model ?? params.model,
      usage: toUsage(data.usage),
      raw: data
    };
  }
}
