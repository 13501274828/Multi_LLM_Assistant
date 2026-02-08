"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clearRefineSession, loadRefineSession } from "@/lib/workflow/refine-session";
import {
  ConversationHistoryRecord,
  getHistoryRecordById,
  listHistoryRecords,
  upsertHistoryRecord
} from "@/lib/workflow/history";
import type { LlmRole } from "@/lib/llm/types";

type DebaterRole = "debater_a" | "debater_b" | "debater_c";
type DebateRound = 1 | 2;
type SummaryMode = "hidden" | "round1" | "round2";
type UiLang = "zh" | "en";

const DEBATER_ROLES: DebaterRole[] = ["debater_a", "debater_b", "debater_c"];

const INTERNAL_ROLE_LABELS: Record<DebaterRole, string> = {
  debater_a: "模型1",
  debater_b: "模型2",
  debater_c: "模型3"
};

const ROLE_LABELS_BY_LANG: Record<UiLang, Record<DebaterRole, string>> = {
  zh: {
    debater_a: "模型1",
    debater_b: "模型2",
    debater_c: "模型3"
  },
  en: {
    debater_a: "Model 1",
    debater_b: "Model 2",
    debater_c: "Model 3"
  }
};

const ROLE_SPEAKERS_BY_LANG: Record<UiLang, Record<DebaterRole, string>> = {
  zh: {
    debater_a: "1号辩手",
    debater_b: "2号辩手",
    debater_c: "3号辩手"
  },
  en: {
    debater_a: "Debater 1",
    debater_b: "Debater 2",
    debater_c: "Debater 3"
  }
};

const UI_LANG_STORAGE_KEY = "multi_llm_ui_lang_v1";

type ModelsResponse = {
  ok: boolean;
  data?: {
    availableModels?: string[];
    effectiveRoleModels?: Partial<Record<LlmRole, string>>;
  };
  error?: string;
};

type TestSuccessResponse = {
  ok: true;
  data: {
    role: LlmRole;
    model: string;
    content: string;
  };
};

type TestErrorResponse = {
  ok: false;
  error?: string;
  details?: string;
};

type DebaterParsedOutput = {
  speaker: string;
  newPerspectives: string[];
  counterpoints: string[];
};

type DebaterResult = {
  model: string;
  rawContent: string;
  parsed: DebaterParsedOutput | null;
  error?: string;
};

type RoundResults = Partial<Record<DebaterRole, DebaterResult>>;

const roundAwarePrompts: Record<DebaterRole, Record<DebateRound, string>> = {
  debater_a: {
    1: `
你是“讨论模型1（方案视角）”。
你是首位辩手，没有上文可反驳。
你的任务：
1) 提出至少 3 个可执行的新视角。
2) 发言简短易懂，禁止过度解释。
3) 不要输出 counterpoints。
4) 语言要求：根据用户输入与聊天记录的主要语言作答。用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。
输出必须是严格 JSON：
{
  "speaker": "1号辩手",
  "new_perspectives": [
    { "id": string, "contents": string }
  ]
}
`.trim(),
    2: `
你是“讨论模型1（方案视角）”。
当前是第二轮，你会看到第一轮全部辩手观点。
你的任务：
1) 提出至少 2 个新的增量视角。
2) 对其他辩手的前序观点给出反驳/修正（counterpoints）。
3) 发言简短易懂，禁止过度解释。
4) 语言要求：根据用户输入与聊天记录的主要语言作答。用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。
输出必须是严格 JSON：
{
  "speaker": "1号辩手",
  "new_perspectives": [
    { "id": string, "contents": string }
  ],
  "counterpoints": [
    { "id": string, "contents": string }
  ]
}
`.trim()
  },
  debater_b: {
    1: `
你是“讨论模型2（质疑视角）”。
你的任务：
1) 提出至少 3 个可执行的新视角。
2) 对其他辩手的前序观点给出反驳/修正（counterpoints）。
3) 发言简短易懂，禁止过度解释。
4) 语言要求：根据用户输入与聊天记录的主要语言作答。用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。
输出必须是严格 JSON：
{
  "speaker": "2号辩手",
  "new_perspectives": [
    { "id": string, "contents": string }
  ],
  "counterpoints": [
    { "id": string, "contents": string }
  ]
}
`.trim(),
    2: `
你是“讨论模型2（质疑视角）”。
当前是第二轮，请结合第一轮和当前轮前序观点做增量回应。
你的任务：
1) 提出至少 2 个新的增量视角。
2) 对其他辩手的前序观点给出反驳/修正（counterpoints）。
3) 发言简短易懂，禁止过度解释。
4) 语言要求：根据用户输入与聊天记录的主要语言作答。用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。
输出必须是严格 JSON：
{
  "speaker": "2号辩手",
  "new_perspectives": [
    { "id": string, "contents": string }
  ],
  "counterpoints": [
    { "id": string, "contents": string }
  ]
}
`.trim()
  },
  debater_c: {
    1: `
你是“讨论模型3（现实约束视角）”。
你的任务：
1) 提出至少 3 个可执行的新视角。
2) 对其他辩手的前序观点给出反驳/修正（counterpoints）。
3) 发言简短易懂，禁止过度解释。
4) 语言要求：根据用户输入与聊天记录的主要语言作答。用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。
输出必须是严格 JSON：
{
  "speaker": "3号辩手",
  "new_perspectives": [
    { "id": string, "contents": string }
  ],
  "counterpoints": [
    { "id": string, "contents": string }
  ]
}
`.trim(),
    2: `
你是“讨论模型3（现实约束视角）”。
当前是第二轮，请结合第一轮和当前轮前序观点做增量回应。
你的任务：
1) 提出至少 2 个新的增量视角。
2) 对关键观点给出反驳/修正（counterpoints）。
3) 发言简短易懂，禁止过度解释。
4) 语言要求：根据用户输入与聊天记录的主要语言作答。用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。
输出必须是严格 JSON：
{
  "speaker": "3号辩手",
  "new_perspectives": [
    { "id": string, "contents": string }
  ],
  "counterpoints": [
    { "id": string, "contents": string }
  ]
}
`.trim()
  }
};

function getVendorName(model: string): string {
  const vendor = model.split("/")[0]?.trim();
  return vendor && vendor.length > 0 ? vendor : model;
}

function buildModelLabels(models: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  const seen: Record<string, number> = {};

  for (const model of models) {
    const vendor = getVendorName(model);
    const nextCount = (seen[vendor] ?? 0) + 1;
    seen[vendor] = nextCount;
    labels[model] = nextCount === 1 ? vendor : `${vendor} ${nextCount}`;
  }

  return labels;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fallback below
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function readContentsArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (item && typeof item === "object") {
        const maybeContents = (item as Record<string, unknown>).contents;
        if (typeof maybeContents === "string") {
          return maybeContents.trim();
        }
      }
      return "";
    })
    .filter((item) => item.length > 0);
}

function parseDebaterOutput(raw: string, fallbackSpeaker: string): DebaterParsedOutput | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return null;
  }

  const speakerRaw = parsed.speaker;
  const speaker =
    typeof speakerRaw === "string" && speakerRaw.trim().length > 0
      ? speakerRaw.trim()
      : fallbackSpeaker;
  const newPerspectives = readContentsArray(parsed.new_perspectives);
  const counterpoints = readContentsArray(parsed.counterpoints);

  if (newPerspectives.length === 0 && counterpoints.length === 0) {
    return null;
  }

  return { speaker, newPerspectives, counterpoints };
}

function getErrorMessage(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    return "Request failed. Please retry.";
  }

  const maybeError = raw as TestErrorResponse;
  if (maybeError.error && maybeError.details) {
    return `${maybeError.error}\n${maybeError.details}`;
  }
  if (maybeError.error) {
    return maybeError.error;
  }
  return "Request failed. Please retry.";
}

function withContextOverflowHint(message: string, language: UiLang): string {
  const normalized = message.toLowerCase();
  const mayBeOverflow =
    normalized.includes("context length") ||
    normalized.includes("maximum context") ||
    normalized.includes("max context") ||
    normalized.includes("max tokens") ||
    normalized.includes("token limit") ||
    normalized.includes("prompt is too long") ||
    normalized.includes("too many tokens");

  if (!mayBeOverflow) {
    return message;
  }

  if (language === "en") {
    return `Context is too long. Reduce rounds or shorten input, then retry.\n\nOriginal error: ${message}`;
  }

  return `上下文过长，请减少轮次或缩短输入后重试。\n\n原始错误：${message}`;
}

function hasRoundCompleted(results: RoundResults): boolean {
  return DEBATER_ROLES.every((role) => Boolean(results[role]));
}

function hasAnyRoundResult(results: RoundResults): boolean {
  return DEBATER_ROLES.some((role) => Boolean(results[role]));
}

function normalizeOptionalText(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function createConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatHistoryTime(value: string, lang: UiLang): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
}

function buildHistoryTitle(record: ConversationHistoryRecord, lang: UiLang): string {
  const base = (record.finalPrompt || record.rawPrompt || "").trim();
  if (!base) {
    return lang === "zh" ? "未命名会话" : "Untitled session";
  }

  return base.length > 80 ? `${base.slice(0, 80)}...` : base;
}

function extractParsedLines(result: DebaterResult): string[] {
  if (!result.parsed) {
    return [];
  }

  const lines: string[] = [];
  result.parsed.newPerspectives.forEach((item, index) => {
    lines.push(`- 新视角${index + 1}: ${item}`);
  });
  result.parsed.counterpoints.forEach((item, index) => {
    lines.push(`- 反驳${index + 1}: ${item}`);
  });
  return lines;
}

function buildDebateContext(
  currentRole: DebaterRole,
  currentRound: DebateRound,
  round1Results: RoundResults,
  currentRoundResults: RoundResults
): string {
  const sections: string[] = [];

  if (currentRound === 2) {
    for (const role of DEBATER_ROLES) {
      const result = round1Results[role];
      if (!result || result.error || !result.parsed) {
        continue;
      }

      const lines = extractParsedLines(result);
      if (lines.length === 0) {
        continue;
      }

      sections.push(`第一轮 ${result.parsed.speaker}\n${lines.join("\n")}`);
    }
  }

  const currentIndex = DEBATER_ROLES.indexOf(currentRole);
  const previousRoles = DEBATER_ROLES.slice(0, currentIndex);
  for (const role of previousRoles) {
    const result = currentRoundResults[role];
    if (!result || result.error || !result.parsed) {
      continue;
    }

    const lines = extractParsedLines(result);
    if (lines.length === 0) {
      continue;
    }

    sections.push(`第${currentRound}轮 ${result.parsed.speaker}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function buildPromptForRole(
  basePrompt: string,
  role: DebaterRole,
  currentRound: DebateRound,
  round1Results: RoundResults,
  currentRoundResults: RoundResults,
  addendum?: string | null
): string {
  const normalizedAddendum = currentRound === 2 ? normalizeOptionalText(addendum) : null;
  const context = buildDebateContext(role, currentRound, round1Results, currentRoundResults);
  const addendumSection = normalizedAddendum
    ? `以下是第一轮后用户补充信息（独立输入）：
[User Addendum After Round 1 / 第一轮后用户补充信息]
${normalizedAddendum}
`
    : "";
  const contextSection = context
    ? `以下是你可用的前序有效观点：
${context}
`
    : "";

  if (!addendumSection && !contextSection) {
    return `${basePrompt}\n\n当前是第${currentRound}轮讨论，请保持输出简短易懂。语言要求：根据用户输入与聊天记录的主要语言作答，用户用英文则输出英文，用户用中文则输出中文。`;
  }

  return `${basePrompt}

当前是第${currentRound}轮讨论。
${addendumSection}${contextSection}

请基于以上内容提出你的新视角与反驳，保持既定 JSON 结构并且不要输出额外文本。`;
}

function buildSummaryBlock(roundLabel: string, results: RoundResults): string {
  const chunks: string[] = [];

  for (const role of DEBATER_ROLES) {
    const result = results[role];
    const roleName = INTERNAL_ROLE_LABELS[role];

    if (!result) {
      chunks.push(`${roleName}: 无输出`);
      continue;
    }

    if (result.error) {
      chunks.push(`${roleName}: 调用失败 -> ${result.error}`);
      continue;
    }

    if (result.parsed) {
      const speaker = result.parsed.speaker;
      const lines = extractParsedLines(result);
      if (lines.length > 0) {
        chunks.push(`${speaker}\n${lines.join("\n")}`);
      } else {
        chunks.push(`${speaker}: 无有效 contents`);
      }
      continue;
    }

    chunks.push(`${roleName}: ${result.rawContent || "无输出"}`);
  }

  return `${roundLabel}\n${chunks.join("\n\n")}`;
}

function buildSummaryPrompt(
  finalPrompt: string,
  round1Results: RoundResults,
  round2Results?: RoundResults,
  addendum?: string | null
): string {
  const normalizedAddendum = normalizeOptionalText(addendum);
  const blocks = [buildSummaryBlock("第一轮讨论结果", round1Results)];
  if (round2Results) {
    blocks.push(buildSummaryBlock("第二轮讨论结果", round2Results));
  }
  const addendumSection = normalizedAddendum
    ? `第一轮后用户补充信息 / User Addendum After Round 1:
${normalizedAddendum}

`
    : "";

  return `用户正式问题：
${finalPrompt}

${addendumSection}请根据以下辩论结果生成总结（简短、清晰、可执行）：
${blocks.join("\n\n")}

输出要求：
1) 严格输出 JSON，遵循你既定的输出 schema（new_perspectives/counterpoints）。
2) 先给最终建议，再给推荐做法与不推荐做法。
3) 推荐做法可为 1 条或多条，不强制 3-5 条。
4) 语言要求：根据用户输入与聊天记录的主要语言输出，用户用英文则输出英文，用户用中文则输出中文。`;
}

function DebatePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const historyId = searchParams.get("historyId")?.trim() ?? "";

  const [uiLang, setUiLang] = useState<UiLang>("zh");
  const [historyRecords, setHistoryRecords] = useState<ConversationHistoryRecord[]>([]);
  const [isHistoryReadonly, setIsHistoryReadonly] = useState<boolean>(false);
  const [currentConversationId, setCurrentConversationId] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [debaterModels, setDebaterModels] = useState<Record<DebaterRole, string>>({
    debater_a: "",
    debater_b: "",
    debater_c: ""
  });
  const [summarizerModel, setSummarizerModel] = useState<string>("");

  const [rawPrompt, setRawPrompt] = useState<string>("");
  const [refinerSuggestion, setRefinerSuggestion] = useState<string>("");
  const [finalPrompt, setFinalPrompt] = useState<string>("");

  const [round1Results, setRound1Results] = useState<RoundResults>({});
  const [round2Results, setRound2Results] = useState<RoundResults>({});
  const [summaryResult, setSummaryResult] = useState<string>("");
  const [summarySourceRound, setSummarySourceRound] = useState<DebateRound | null>(null);
  const [round2AddendumDraft, setRound2AddendumDraft] = useState<string>("");
  const [round2AddendumCommitted, setRound2AddendumCommitted] = useState<string | null>(null);
  const [round2Started, setRound2Started] = useState<boolean>(false);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("hidden");

  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);
  const [isRunningDebate, setIsRunningDebate] = useState<boolean>(false);
  const [runningRound, setRunningRound] = useState<DebateRound | null>(null);
  const [runningRole, setRunningRole] = useState<DebaterRole | null>(null);
  const [isRunningSummary, setIsRunningSummary] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string>("");
  const [modelsError, setModelsError] = useState<string>("");
  const [debateError, setDebateError] = useState<string>("");
  const [summaryError, setSummaryError] = useState<string>("");

  const tr = (zhText: string, enText: string): string => (uiLang === "zh" ? zhText : enText);
  const isReadOnlyView = isHistoryReadonly;
  const roleLabels = ROLE_LABELS_BY_LANG[uiLang];
  const roleSpeakers = ROLE_SPEAKERS_BY_LANG[uiLang];

  const modelLabels = useMemo(() => buildModelLabels(availableModels), [availableModels]);
  const round1Completed = hasRoundCompleted(round1Results);
  const round2Completed = hasRoundCompleted(round2Results);
  const showRound2Section = hasAnyRoundResult(round2Results) || runningRound === 2;
  const showSummarySection = summaryMode !== "hidden";
  const summaryStepTitle =
    summaryMode === "round2"
      ? tr("步骤5：生成总结", "Step 5: Generate Summary")
      : tr("步骤4：生成总结", "Step 4: Generate Summary");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(UI_LANG_STORAGE_KEY);
    if (saved === "zh" || saved === "en") {
      setUiLang(saved);
    }
  }, []);

  function handleLanguageChange(nextLanguage: UiLang): void {
    setUiLang(nextLanguage);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(UI_LANG_STORAGE_KEY, nextLanguage);
    }
  }

  useEffect(() => {
    setHistoryRecords(listHistoryRecords());
  }, []);

  useEffect(() => {
    if (historyId) {
      const record = getHistoryRecordById(historyId);
      if (!record) {
        setIsHistoryReadonly(true);
        setPageError(
          tr(
            "未找到该历史记录（可能已被清除）。请返回首页重新开始。",
            "History record not found (it may have been removed). Please go back to home and start a new session."
          )
        );
        return;
      }

      setPageError("");
      setIsHistoryReadonly(true);
      setCurrentConversationId(record.id);
      setRawPrompt(record.rawPrompt);
      setRefinerSuggestion(record.refinerSuggestion);
      setFinalPrompt(record.finalPrompt);
      setDebaterModels(record.debaterModels as Record<DebaterRole, string>);
      setSummarizerModel(record.summarizerModel);
      setRound1Results(record.round1Results as RoundResults);
      setRound2Results(record.round2Results as RoundResults);
      setRound2Started(record.round2Started);
      setRound2AddendumDraft(record.round2AddendumDraft);
      setRound2AddendumCommitted(record.round2AddendumCommitted);
      setSummaryResult(record.summaryResult);
      setSummarySourceRound(record.summarySourceRound);
      setSummaryMode(record.summarySourceRound === 2 ? "round2" : "round1");
      setDebateError("");
      setSummaryError("");
      return;
    }

    const session = loadRefineSession();
    if (!session) {
      setIsHistoryReadonly(false);
      setPageError(
        tr(
          "未找到步骤1的结果，请先返回首页完成规划师精炼。",
          "Step 1 result was not found. Please go back to the home page and run the refiner first."
        )
      );
      return;
    }

    setPageError("");
    setIsHistoryReadonly(false);
    setCurrentConversationId(createConversationId());
    setRawPrompt(session.rawPrompt);
    setRefinerSuggestion(session.refinerSuggestion);
    setFinalPrompt("");
    setRound1Results({});
    setRound2Results({});
    setSummaryResult("");
    setSummarySourceRound(null);
    setRound2Started(false);
    setSummaryMode("hidden");
    setRound2AddendumDraft("");
    setRound2AddendumCommitted(null);
    setDebateError("");
    setSummaryError("");
  }, [historyId]);

  useEffect(() => {
    let cancelled = false;
    const loadModelsErrorText = uiLang === "zh" ? "加载模型失败" : "Failed to load models";

    async function loadModels() {
      setIsLoadingModels(true);
      setModelsError("");

      try {
        const response = await fetch("/api/llm/models");
        const data = (await response.json()) as ModelsResponse;

        if (!response.ok || !data.ok || !data.data) {
          throw new Error(data.error ?? loadModelsErrorText);
        }

        if (cancelled) {
          return;
        }

        const models = data.data.availableModels ?? [];
        const defaults = data.data.effectiveRoleModels ?? {};
        const firstModel = models[0] ?? "";

        setAvailableModels(models);
        if (!historyId) {
          setDebaterModels({
            debater_a: defaults.debater_a ?? firstModel,
            debater_b: defaults.debater_b ?? firstModel,
            debater_c: defaults.debater_c ?? firstModel
          });
          setSummarizerModel(defaults.summarizer ?? firstModel);
        }
      } catch (error) {
        if (!cancelled) {
          setModelsError(error instanceof Error ? error.message : loadModelsErrorText);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false);
        }
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, [uiLang, historyId]);

  async function runSingleDebater(
    role: DebaterRole,
    model: string,
    prompt: string,
    systemPrompt: string
  ): Promise<DebaterResult> {
    const response = await fetch("/api/llm/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role,
        model,
        prompt,
        systemPrompt,
        allowFallback: true
      })
    });

    const data = (await response.json()) as TestSuccessResponse | TestErrorResponse;
    if (!response.ok || !data.ok) {
      throw new Error(getErrorMessage(data));
    }

    const rawContent = data.data.content.trim();
    return {
      model: data.data.model,
      rawContent,
      parsed: parseDebaterOutput(rawContent, roleSpeakers[role])
    };
  }

  async function runDebateRound(
    round: DebateRound,
    prompt: string,
    addendum?: string | null
  ): Promise<void> {
    const currentResults: RoundResults = {};
    const stableRound1Results = round === 2 ? { ...round1Results } : {};

    for (const role of DEBATER_ROLES) {
      setRunningRole(role);
      const model = debaterModels[role];
      const chainedPrompt = buildPromptForRole(
        prompt,
        role,
        round,
        stableRound1Results,
        currentResults,
        addendum
      );
      const systemPrompt = roundAwarePrompts[role][round];

      let result: DebaterResult;
      try {
        result = await runSingleDebater(role, model, chainedPrompt, systemPrompt);
      } catch (error) {
        const message =
          error instanceof Error
            ? withContextOverflowHint(error.message, uiLang)
            : tr("调用失败", "Request failed");
        result = {
          model,
          rawContent: "",
          parsed: null,
          error: message
        };
      }

      currentResults[role] = result;
      if (round === 1) {
        setRound1Results({ ...currentResults });
      } else {
        setRound2Results({ ...currentResults });
      }
    }
  }

  async function handleRunRound1() {
    setDebateError("");
    setSummaryError("");
    setSummaryResult("");
    setSummarySourceRound(null);

    if (pageError) {
      return;
    }

    const prompt = finalPrompt.trim();
    if (!prompt) {
      setDebateError(
        tr("请先在步骤2输入你的正式 Prompt。", "Please enter your final prompt in Step 2 first.")
      );
      return;
    }

    for (const role of DEBATER_ROLES) {
      if (!debaterModels[role]) {
        setDebateError(
          tr(`请先为${roleLabels[role]}选择模型。`, `Please select a model for ${roleLabels[role]}.`)
        );
        return;
      }
    }

    setRound1Results({});
    setRound2Results({});
    setRound2AddendumDraft("");
    setRound2AddendumCommitted(null);
    setRound2Started(false);
    setSummaryMode("hidden");
    setIsRunningDebate(true);
    setRunningRound(1);
    setRunningRole(null);
    try {
      await runDebateRound(1, prompt);
    } catch (error) {
      setDebateError(
        error instanceof Error
          ? error.message
          : tr("第一轮讨论失败，请稍后重试。", "Round 1 failed. Please retry.")
      );
    } finally {
      setRunningRole(null);
      setRunningRound(null);
      setIsRunningDebate(false);
    }
  }

  async function handleRunRound2() {
    setDebateError("");
    setSummaryError("");
    setSummaryResult("");
    setSummarySourceRound(null);

    if (!round1Completed) {
      setDebateError(tr("请先完成第一轮讨论。", "Please complete Round 1 first."));
      return;
    }

    const prompt = finalPrompt.trim();
    if (!prompt) {
      setDebateError(
        tr("请先在步骤2输入你的正式 Prompt。", "Please enter your final prompt in Step 2 first.")
      );
      return;
    }

    setRound2Results({});
    const committedAddendum = normalizeOptionalText(round2AddendumDraft);
    setRound2AddendumCommitted(committedAddendum);
    setRound2Started(true);
    setSummaryMode("hidden");
    setIsRunningDebate(true);
    setRunningRound(2);
    setRunningRole(null);
    try {
      await runDebateRound(2, prompt, committedAddendum);
    } catch (error) {
      setDebateError(
        error instanceof Error
          ? error.message
          : tr("第二轮讨论失败，请稍后重试。", "Round 2 failed. Please retry.")
      );
    } finally {
      setRunningRole(null);
      setRunningRound(null);
      setIsRunningDebate(false);
      setSummaryMode("round2");
    }
  }

  async function handleSkipRound2AndSummarize(): Promise<void> {
    setRound2Started(false);
    setSummaryMode("round1");
    await handleGenerateSummary(false);
  }

  async function handleGenerateSummary(useRound2: boolean) {
    setSummaryError("");
    setSummaryResult("");

    if (!round1Completed) {
      setSummaryError(
        tr(
          "请先完成第一轮讨论，再生成总结。",
          "Please complete Round 1 before generating a summary."
        )
      );
      return;
    }

    if (useRound2 && !round2Completed) {
      setSummaryError(
        tr(
          "第二轮尚未完成，无法基于两轮生成总结。",
          "Round 2 is not finished yet. Cannot summarize both rounds."
        )
      );
      return;
    }

    if (!summarizerModel) {
      setSummaryError(tr("请先选择总结模型。", "Please select a summarizer model first."));
      return;
    }

    const prompt = finalPrompt.trim();
    if (!prompt) {
      setSummaryError(
        tr("缺少正式 Prompt，无法生成总结。", "Final prompt is missing. Cannot generate summary.")
      );
      return;
    }

    const summaryPrompt = buildSummaryPrompt(
      prompt,
      round1Results,
      useRound2 ? round2Results : undefined,
      useRound2 ? round2AddendumCommitted : normalizeOptionalText(round2AddendumDraft)
    );

    setIsRunningSummary(true);
    try {
      const response = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "summarizer",
          model: summarizerModel,
          prompt: summaryPrompt,
          allowFallback: true
        })
      });

      const data = (await response.json()) as TestSuccessResponse | TestErrorResponse;
      if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data));
      }

      const content = data.data.content.trim();
      const sourceRound: DebateRound = useRound2 ? 2 : 1;
      setSummaryResult(content);
      setSummarySourceRound(sourceRound);

      if (!isReadOnlyView) {
        const conversationId = currentConversationId || createConversationId();
        if (!currentConversationId) {
          setCurrentConversationId(conversationId);
        }

        const persistedHistory = upsertHistoryRecord({
          id: conversationId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          uiLang,
          rawPrompt,
          refinerSuggestion,
          finalPrompt: prompt,
          debaterModels: {
            debater_a: debaterModels.debater_a,
            debater_b: debaterModels.debater_b,
            debater_c: debaterModels.debater_c
          },
          summarizerModel,
          round1Results: round1Results as ConversationHistoryRecord["round1Results"],
          round2Results: round2Results as ConversationHistoryRecord["round2Results"],
          round2Started,
          round2AddendumDraft,
          round2AddendumCommitted,
          summaryResult: content,
          summarySourceRound: sourceRound
        });
        setHistoryRecords(persistedHistory);
      }
    } catch (error) {
      setSummaryError(
        error instanceof Error
          ? withContextOverflowHint(error.message, uiLang)
          : tr("总结生成失败，请稍后重试。", "Summary generation failed. Please retry.")
      );
    } finally {
      setIsRunningSummary(false);
    }
  }

  function handleStartNewQuestion(): void {
    clearRefineSession();
    router.push("/");
  }

  function renderRoundResults(round: DebateRound, results: RoundResults) {
    const isCurrentRunningRound = isRunningDebate && runningRound === round;
    const runningIndex = runningRole ? DEBATER_ROLES.indexOf(runningRole) : -1;

    return (
      <section className="card stack">
        <h2>
          {tr(`第${round}轮 Debater 输出`, `Round ${round} Debater Outputs (contents only)`)}
        </h2>

        <div className="three-col">
          {DEBATER_ROLES.map((role) => {
            const result = results[role];
            const roleIndex = DEBATER_ROLES.indexOf(role);
            const speaker = result?.parsed?.speaker ?? roleSpeakers[role];

            return (
              <div key={`${round}-${role}`} className="subcard stack">
                <h3>
                  {roleLabels[role]} · {speaker}
                  {result?.model ? ` · ${modelLabels[result.model] ?? getVendorName(result.model)}` : ""}
                </h3>

                {!result && !isCurrentRunningRound ? (
                  <p className="muted">{tr("尚未生成", "Not generated yet")}</p>
                ) : null}
                {!result && isCurrentRunningRound && roleIndex > runningIndex ? (
                  <p className="muted">{tr("等待前序辩手输出...", "Waiting for previous debater...")}</p>
                ) : null}
                {!result && isCurrentRunningRound && roleIndex === runningIndex ? (
                  <p className="muted">{tr("正在生成...", "Generating...")}</p>
                ) : null}

                {result?.error ? <pre>{result.error}</pre> : null}

                {result && !result.error && result.parsed ? (
                  <>
                    {result.parsed.newPerspectives.length > 0 ? (
                      <>
                        <label>new_perspectives.contents</label>
                        <ul>
                          {result.parsed.newPerspectives.map((item, index) => (
                            <li key={`r${round}-np-${role}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}

                    {result.parsed.counterpoints.length > 0 ? (
                      <>
                        <label>counterpoints.contents</label>
                        <ul>
                          {result.parsed.counterpoints.map((item, index) => (
                            <li key={`r${round}-cp-${role}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </>
                ) : null}

                {result && !result.error && !result.parsed ? (
                  <pre>
                    {result.rawContent ||
                      tr(
                        "模型返回无法按目标 JSON 解析，请调整 prompt 后重试。",
                        "Model output cannot be parsed as target JSON. Please adjust prompts and retry."
                      )}
                  </pre>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <main>
      <h1>Multi-LLM Assistant</h1>
      <div className="top-bar">
        <p>{tr("第 2 步：查看规划师建议，重新输入正式 Prompt，并开始讨论。", "Step 2: Review refiner output, rewrite your final prompt, then debate and summarize.")}</p>
        <div className="actions-row">
          <button type="button" onClick={() => handleLanguageChange("zh")} disabled={uiLang === "zh"}>
            中文
          </button>
          <button type="button" onClick={() => handleLanguageChange("en")} disabled={uiLang === "en"}>
            English
          </button>
        </div>
      </div>

      <section className="card stack">
        <h2>{tr("最近对话", "Recent conversations (max 3)")}</h2>
        {historyRecords.length === 0 ? (
          <p className="muted">
            {tr("暂无已完成总结的历史记录。", "No completed conversation history yet.")}
          </p>
        ) : (
          <ul className="history-list">
            {historyRecords.map((record) => (
              <li key={record.id}>
                <Link href={`/debate?historyId=${record.id}`}>{buildHistoryTitle(record, uiLang)}</Link>
                <p className="muted">
                  {tr("更新时间", "Updated")}: {formatHistoryTime(record.updatedAt, uiLang)} ·{" "}
                  {record.summarySourceRound === 2
                    ? tr("基于两轮总结", "Based on two rounds")
                    : tr("基于第一轮总结", "Based on round 1")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pageError ? (
        <section className="card stack">
          <pre>{pageError}</pre>
          <Link href="/">{tr("返回首页", "Back to Home")}</Link>
        </section>
      ) : (
        <>
          {isReadOnlyView ? (
            <section className="card stack">
              <p className="muted">
                {tr(
                  "当前是历史记录回看模式（只读）。此页面展示当时总结结果，不可继续改写流程。",
                  "You are viewing a historical conversation in read-only mode. This page shows the saved summary snapshot."
                )}
              </p>
            </section>
          ) : null}
          <section className="card stack">
            <h2>{tr("步骤1结果：规划师输出", "Step 1 Result: Refiner Output")}</h2>
            <label>{tr("你的原始问题", "Your raw prompt")}</label>
            <pre>{rawPrompt || tr("(空)", "(empty)")}</pre>
            <label>{tr("规划师建议（完整输出）", "Refiner suggestion (full output)")}</label>
            <pre>{refinerSuggestion || tr("(空)", "(empty)")}</pre>
          </section>

          <section className="card stack">
            <h2>{tr("步骤2：用户重新输入正式 Prompt", "Step 2: Rewrite final prompt")}</h2>
            <label htmlFor="final-prompt">{tr("你的正式 Prompt（手动输入）", "Your final prompt (manual input)")}</label>
            <textarea
              id="final-prompt"
              rows={10}
              placeholder={tr(
                "根据上面的建议，写一版你自己的正式 Prompt。",
                "Based on the refiner output, rewrite your final prompt."
              )}
              value={finalPrompt}
              onChange={(event) => setFinalPrompt(event.target.value)}
              disabled={isReadOnlyView}
            />
          </section>

          <section className="card stack">
            <h2>{tr("步骤3：配置模型", "Step 3: Configure models and start Round 1")}</h2>

            <div className="three-col">
              {DEBATER_ROLES.map((role) => (
                <div key={role} className="subcard stack">
                  <label htmlFor={`model-${role}`}>{roleLabels[role]}</label>
                  <select
                    id={`model-${role}`}
                    value={debaterModels[role]}
                    onChange={(event) =>
                      setDebaterModels((prev) => ({
                        ...prev,
                        [role]: event.target.value
                      }))
                    }
                    disabled={
                      isReadOnlyView ||
                      isLoadingModels ||
                      availableModels.length === 0 ||
                      isRunningDebate
                    }
                  >
                    {availableModels.map((model) => (
                      <option key={model} value={model}>
                        {modelLabels[model]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <button
              onClick={handleRunRound1}
              disabled={
                isReadOnlyView ||
                isRunningDebate ||
                isLoadingModels ||
                availableModels.length === 0
              }
            >
              {isRunningDebate && runningRound === 1 && runningRole
                ? tr(
                    `第一轮执行中：${roleLabels[runningRole]}（${roleSpeakers[runningRole]}）`,
                    `Round 1 running: ${roleLabels[runningRole]} (${roleSpeakers[runningRole]})`
                  )
                : tr("开始第一轮讨论", "Start Round 1")}
            </button>

            {isRunningDebate && runningRound === 1 && runningRole ? (
              <p className="muted">
                {tr("当前执行第一轮：", "Running Round 1: ")}
                {roleLabels[runningRole]}。
              </p>
            ) : null}

            {round1Completed ? (
              <p className="muted">
                {tr(
                  "第一轮已完成。你可以选择进入第二轮，或直接生成总结。",
                  "Round 1 is done. You can start Round 2 or summarize directly."
                )}
              </p>
            ) : null}

            {modelsError ? <pre>{modelsError}</pre> : null}
            {debateError ? <pre>{debateError}</pre> : null}
          </section>

          {renderRoundResults(1, round1Results)}

          {round1Completed ? (
            <section className="card stack">
              <h2>{tr("步骤4：第二轮决策", "Step 4: Round 2 decision")}</h2>
              <div className="stack">
                <label htmlFor="round2-addendum">
                  {tr("第一轮后补充信息（可选）", "Post-Round-1 addendum (optional)")}
                </label>
                <textarea
                  id="round2-addendum"
                  rows={4}
                  placeholder={tr(
                    "可选：补充第二轮需要重点考虑的新信息、约束或偏好。",
                    "Optional: add new facts, constraints, or preferences for Round 2."
                  )}
                  value={round2AddendumDraft}
                  onChange={(event) => setRound2AddendumDraft(event.target.value)}
                  disabled={isReadOnlyView || round2Started || isRunningDebate || isRunningSummary}
                />
              </div>

              {!round2Started ? (
                <p className="muted">
                  {tr(
                    "这段补充信息会被注入第二轮辩论和后续总结；留空则按原流程执行。",
                    "This addendum will be injected into Round 2 and later summary. Leave empty to keep current behavior."
                  )}
                </p>
              ) : null}
              {round2Started ? (
                <p className="muted">
                  {tr(
                    "补充信息已在第二轮启动时注入，并用于第两轮总结。",
                    "The addendum was locked at Round 2 start and will be used for two-round summary."
                  )}
                </p>
              ) : null}

              {!round2Started ? (
                <div className="actions-row">
                  <button
                    onClick={handleRunRound2}
                    disabled={isReadOnlyView || isRunningDebate || isRunningSummary}
                  >
                    {isRunningDebate && runningRound === 2 && runningRole
                      ? tr(
                          `第二轮执行中：${roleLabels[runningRole]}（${roleSpeakers[runningRole]}）`,
                          `Round 2 running: ${roleLabels[runningRole]} (${roleSpeakers[runningRole]})`
                        )
                      : tr("开始第二轮讨论", "Start Round 2")}
                  </button>
                  <button
                    onClick={handleSkipRound2AndSummarize}
                    disabled={isReadOnlyView || isRunningSummary || isRunningDebate}
                  >
                    {isRunningSummary && summarySourceRound === 1
                      ? tr("总结生成中...", "Generating summary...")
                      : tr("跳过第二轮，直接总结", "Skip Round 2 and summarize")}
                  </button>
                </div>
              ) : null}

              {round2Started && !round2Completed ? (
                <p className="muted">
                  {tr(
                    "第二轮已启动。总结区将在第二轮结束后出现。",
                    "Round 2 has started. Summary section will appear after Round 2 finishes."
                  )}
                </p>
              ) : null}
              {round2Completed ? (
                <p className="muted">
                  {tr("第二轮已完成。现在可以生成两轮总结。", "Round 2 is done. You can now generate a two-round summary.")}
                </p>
              ) : null}

              {isRunningDebate && runningRound === 2 && runningRole ? (
                <p className="muted">
                  {tr(
                    `当前执行第二轮：${roleLabels[runningRole]}。模型1会看到第一轮自己与模型2/3的输出。`,
                    `Running Round 2: ${roleLabels[runningRole]}. Model 1 will see its own Round 1 output and outputs from Model 2/3.`
                  )}
                </p>
              ) : null}
            </section>
          ) : null}

          {showRound2Section ? renderRoundResults(2, round2Results) : null}

          {showSummarySection ? (
            <section className="card stack">
              <h2>{summaryStepTitle}</h2>
              <div className="stack">
                <label htmlFor="summarizer-model">{tr("总结模型", "Summarizer model")}</label>
                <select
                  id="summarizer-model"
                  value={summarizerModel}
                  onChange={(event) => setSummarizerModel(event.target.value)}
                  disabled={
                    isReadOnlyView ||
                    isLoadingModels ||
                    availableModels.length === 0 ||
                    isRunningSummary
                  }
                >
                  {availableModels.map((model) => (
                    <option key={`sum-${model}`} value={model}>
                      {modelLabels[model]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="actions-row">
                {summaryMode === "round1" ? (
                  <button
                    onClick={() => handleGenerateSummary(false)}
                    disabled={isReadOnlyView || isRunningSummary || isRunningDebate}
                  >
                    {isRunningSummary && summarySourceRound === 1
                      ? tr("总结生成中...", "Generating summary...")
                      : tr("基于第一轮生成总结", "Generate summary from Round 1")}
                  </button>
                ) : null}
                {summaryMode === "round2" ? (
                  <button
                    onClick={() => handleGenerateSummary(true)}
                    disabled={isReadOnlyView || isRunningSummary || isRunningDebate || !round2Completed}
                  >
                    {isRunningSummary && summarySourceRound === 2
                      ? tr("总结生成中...", "Generating summary...")
                      : tr("基于两轮生成总结", "Generate summary from two rounds")}
                  </button>
                ) : null}
              </div>

              {summaryError ? <pre>{summaryError}</pre> : null}
              {summaryResult ? (
                <>
                  <h3>
                    {tr("总结", "Summary output")}
                    {summarySourceRound
                      ? tr(`（基于第${summarySourceRound}轮）`, ` (based on round ${summarySourceRound})`)
                      : ""}
                  </h3>
                  <pre>{summaryResult}</pre>
                  <div className="actions-row">
                    <button type="button" onClick={handleStartNewQuestion}>
                      {tr("开始新问题", "Start a new question")}
                    </button>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

export default function DebatePage() {
  return (
    <Suspense
      fallback={
        <main>
          <h1>Multi-LLM Assistant</h1>
          <p>Loading debate page...</p>
        </main>
      }
    >
      <DebatePageContent />
    </Suspense>
  );
}
