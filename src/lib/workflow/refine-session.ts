export const REFINE_SESSION_KEY = "multi_llm_refine_state_v1";

export type RefineSessionState = {
  rawPrompt: string;
  refinerSuggestion: string;
  refinerModel: string;
  createdAt: string;
};

export function saveRefineSession(state: RefineSessionState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(REFINE_SESSION_KEY, JSON.stringify(state));
}

export function loadRefineSession(): RefineSessionState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(REFINE_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RefineSessionState>;
    if (
      typeof parsed.rawPrompt !== "string" ||
      typeof parsed.refinerSuggestion !== "string" ||
      typeof parsed.refinerModel !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }

    return {
      rawPrompt: parsed.rawPrompt,
      refinerSuggestion: parsed.refinerSuggestion,
      refinerModel: parsed.refinerModel,
      createdAt: parsed.createdAt
    };
  } catch {
    return null;
  }
}

export function clearRefineSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(REFINE_SESSION_KEY);
}
