export const LLM_ROLES = [
  "refiner",
  "debater_a",
  "debater_b",
  "debater_c",
  "summarizer"
] as const;

export type LlmRole = (typeof LLM_ROLES)[number];

export type RoleModelMap = Partial<Record<LlmRole, string>>;

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelResponse {
  content: string;
  model: string;
  usage?: ModelUsage;
  raw?: unknown;
}

export interface ModelProvider {
  chatCompletion(params: ChatCompletionParams): Promise<ModelResponse>;
}
