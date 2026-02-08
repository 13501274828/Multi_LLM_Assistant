export const HISTORY_STORAGE_KEY = "multi_llm_history_v1";
export const MAX_HISTORY = 3;

export type UiLanguage = "zh" | "en";
export type HistoryDebaterRole = "debater_a" | "debater_b" | "debater_c";
export type HistorySummaryRound = 1 | 2 | null;

export type ConversationHistoryDebaterParsedOutput = {
  speaker: string;
  newPerspectives: string[];
  counterpoints: string[];
};

export type ConversationHistoryDebaterResult = {
  model: string;
  rawContent: string;
  parsed: ConversationHistoryDebaterParsedOutput | null;
  error?: string;
};

export type ConversationHistoryRoundResults = Partial<
  Record<HistoryDebaterRole, ConversationHistoryDebaterResult>
>;

export type ConversationHistoryRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  uiLang: UiLanguage;
  rawPrompt: string;
  refinerSuggestion: string;
  finalPrompt: string;
  debaterModels: Record<HistoryDebaterRole, string>;
  summarizerModel: string;
  round1Results: ConversationHistoryRoundResults;
  round2Results: ConversationHistoryRoundResults;
  round2Started: boolean;
  round2AddendumDraft: string;
  round2AddendumCommitted: string | null;
  summaryResult: string;
  summarySourceRound: HistorySummaryRound;
};

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readRawHistoryList(): ConversationHistoryRecord[] {
  if (!canUseBrowserStorage()) {
    return [];
  }

  const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is ConversationHistoryRecord => {
      return Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as { id?: unknown }).id === "string" &&
          typeof (item as { createdAt?: unknown }).createdAt === "string" &&
          typeof (item as { updatedAt?: unknown }).updatedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeHistoryList(records: ConversationHistoryRecord[]): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
}

function toTimeNumber(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export function pruneToMaxHistory(
  records: ConversationHistoryRecord[],
  maxHistory = MAX_HISTORY
): ConversationHistoryRecord[] {
  const sorted = [...records].sort((a, b) => toTimeNumber(b.updatedAt) - toTimeNumber(a.updatedAt));
  return sorted.slice(0, Math.max(0, maxHistory));
}

export function listHistoryRecords(): ConversationHistoryRecord[] {
  return pruneToMaxHistory(readRawHistoryList());
}

export function getHistoryRecordById(id: string): ConversationHistoryRecord | null {
  const normalizedId = id.trim();
  if (!normalizedId) {
    return null;
  }

  const found = listHistoryRecords().find((record) => record.id === normalizedId);
  return found ?? null;
}

export function upsertHistoryRecord(record: ConversationHistoryRecord): ConversationHistoryRecord[] {
  const nowIso = new Date().toISOString();
  const current = readRawHistoryList();
  const existingIndex = current.findIndex((item) => item.id === record.id);

  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    current[existingIndex] = {
      ...record,
      createdAt: existing.createdAt,
      updatedAt: nowIso
    };
  } else {
    current.push({
      ...record,
      createdAt: record.createdAt || nowIso,
      updatedAt: nowIso
    });
  }

  const pruned = pruneToMaxHistory(current);
  writeHistoryList(pruned);
  return pruned;
}
