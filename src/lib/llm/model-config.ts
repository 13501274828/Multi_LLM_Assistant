import { LlmRole, RoleModelMap } from "./types";

const BASE_AVAILABLE_MODELS = [
  "openai/gpt-oss-120b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-3-27b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1-0528:free",
  "deepseek/deepseek-v3.2"
] as const;

function parseModelList(raw?: string): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function getAvailableModels(): string[] {
  const customModels = parseModelList(process.env.OPENROUTER_MODELS?.trim());
  const extraModels = parseModelList(process.env.OPENROUTER_EXTRA_MODELS?.trim());
  const seed = customModels.length > 0 ? customModels : [...BASE_AVAILABLE_MODELS];
  const merged = [...seed, ...extraModels];
  return Array.from(new Set(merged));
}

export const DEFAULT_ROLE_MODEL_MAP: Record<LlmRole, string> = {
  refiner: "qwen/qwen3-next-80b-a3b-instruct:free",
  debater_a: "openai/gpt-oss-120b:free",
  debater_b: "google/gemma-3-27b-it:free",
  debater_c: "meta-llama/llama-3.3-70b-instruct:free",
  summarizer: "deepseek/deepseek-v3.2"
};

export function isAllowedModel(model: string): boolean {
  const normalized = model.trim();
  if (normalized.length === 0) {
    return false;
  }

  if (getAvailableModels().includes(normalized)) {
    return true;
  }

  // Allow valid OpenRouter model ids even if not pre-listed.
  return /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(normalized);
}

export function supportsSystemPrompt(model: string): boolean {
  const normalized = model.trim();
  return !normalized.startsWith("google/gemma");
}

export function resolveModelForRole(role: LlmRole, roleModelMap?: RoleModelMap): string {
  const fromRequest = roleModelMap?.[role]?.trim();
  if (fromRequest && isAllowedModel(fromRequest)) {
    return fromRequest;
  }

  const fromDefaults = DEFAULT_ROLE_MODEL_MAP[role];
  if (isAllowedModel(fromDefaults)) {
    return fromDefaults;
  }

  const firstAvailableModel = getAvailableModels()[0];
  if (firstAvailableModel) {
    return firstAvailableModel;
  }

  throw new Error(
    "No available models configured. Please set OPENROUTER_MODELS in .env.local."
  );
}
