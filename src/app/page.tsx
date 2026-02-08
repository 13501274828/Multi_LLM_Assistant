"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveRefineSession } from "@/lib/workflow/refine-session";
import {
  ConversationHistoryRecord,
  listHistoryRecords
} from "@/lib/workflow/history";
import type { LlmRole } from "@/lib/llm/types";

type UiLang = "zh" | "en";
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

export default function HomePage() {
  const router = useRouter();
  const [uiLang, setUiLang] = useState<UiLang>("zh");
  const [historyRecords, setHistoryRecords] = useState<ConversationHistoryRecord[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [refinerModel, setRefinerModel] = useState<string>("");
  const [rawPrompt, setRawPrompt] = useState<string>("");
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string>("");
  const [refineError, setRefineError] = useState<string>("");

  const tr = (zhText: string, enText: string): string => (uiLang === "zh" ? zhText : enText);
  const modelLabels = useMemo(() => buildModelLabels(availableModels), [availableModels]);

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
        setAvailableModels(models);
        setRefinerModel(defaults.refiner ?? models[0] ?? "");
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
  }, [uiLang]);

  async function handleRefineAndGoNext() {
    setRefineError("");

    const prompt = rawPrompt.trim();
    if (!prompt) {
      setRefineError(tr("请先输入问题。", "Please enter prompt."));
      return;
    }

    if (!refinerModel) {
      setRefineError(tr("请选择规划师模型。", "Please select a refiner model."));
      return;
    }

    setIsRefining(true);
    try {
      const response = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "refiner",
          model: refinerModel,
          prompt,
          allowFallback: true
        })
      });

      const data = (await response.json()) as TestSuccessResponse | TestErrorResponse;
      if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data));
      }

      saveRefineSession({
        rawPrompt: prompt,
        refinerSuggestion: data.data.content.trim(),
        refinerModel: data.data.model,
        createdAt: new Date().toISOString()
      });

      router.push("/debate");
    } catch (error) {
      setRefineError(
        error instanceof Error ? error.message : tr("精炼失败，请稍后重试。", "Refining failed. Please retry.")
      );
    } finally {
      setIsRefining(false);
    }
  }

  return (
    <main>
      <h1>Multi-LLM Assistant</h1>
      <div className="top-bar">
        <p>
          {tr(
            "第 1 步：输入问题并调用规划师。",
            "Step 1: Enter your  prompt and call the refiner."
          )}
        </p>
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

      <section className="card stack">
        <h2>{tr("步骤1：规划师精炼", "Step 1: Refiner")}</h2>

        <div className="stack">
          <label htmlFor="raw-prompt">{tr("原始输入", "Raw prompt")}</label>
          <textarea
            id="raw-prompt"
            rows={7}
            placeholder={tr(
              "例如：我想系统学习 AI，但是不知道从哪里开始。",
              "Example: I want to learn AI , but I don't know where to start."
            )}
            value={rawPrompt}
            onChange={(event) => setRawPrompt(event.target.value)}
          />
        </div>

        <div className="stack">
          <label htmlFor="refiner-model">{tr("规划师模型", "Refiner model")}</label>
          <select
            id="refiner-model"
            value={refinerModel}
            onChange={(event) => setRefinerModel(event.target.value)}
            disabled={isLoadingModels || availableModels.length === 0}
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {modelLabels[model]}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRefineAndGoNext}
          disabled={isRefining || isLoadingModels || availableModels.length === 0}
        >
          {isRefining
            ? tr("生成中...", "Generating...")
            : tr("生成建议并进入下一步", "Generate and go to next step")}
        </button>

        {modelsError ? <pre>{modelsError}</pre> : null}
        {refineError ? <pre>{refineError}</pre> : null}
      </section>
    </main>
  );
}
