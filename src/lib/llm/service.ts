import {
  getAvailableModels,
  resolveModelForRole,
  supportsSystemPrompt
} from "./model-config";
import { OpenRouterHttpError, OpenRouterProvider } from "./providers/openrouter";
import { ChatMessage, LlmRole, ModelResponse, RoleModelMap } from "./types";

let provider: OpenRouterProvider | null = null;

function getProvider(): OpenRouterProvider {
  if (!provider) {
    provider = new OpenRouterProvider();
  }
  return provider;
}

function getFallbackModels(primaryModel: string): string[] {
  return getAvailableModels().filter((model) => model !== primaryModel);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const defaultRoleMaxTokens: Record<LlmRole, number> = {
  refiner: 500,
  debater_a: 800,
  debater_b: 800,
  debater_c: 800,
  summarizer: 900
};

function parsePositiveInt(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function resolveMaxTokens(role: LlmRole, override?: number): number {
  const hardCap = parsePositiveInt(process.env.OPENROUTER_MAX_TOKENS_CAP) ?? 4096;
  const perRoleEnvKey = `OPENROUTER_MAX_TOKENS_${role.toUpperCase()}`;
  const fromEnv = parsePositiveInt(process.env[perRoleEnvKey]);
  const fromOverride =
    typeof override === "number" && Number.isFinite(override) && override > 0
      ? Math.floor(override)
      : undefined;

  const baseValue = fromOverride ?? fromEnv ?? defaultRoleMaxTokens[role];
  return Math.min(baseValue, hardCap);
}

function buildMessagesForModel(
  model: string,
  systemPrompt: string,
  userPrompt: string
): ChatMessage[] {
  if (supportsSystemPrompt(model)) {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
  }

  return [
    {
      role: "user",
      content: `System instruction:\n${systemPrompt}\n\nUser prompt:\n${userPrompt}`
    }
  ];
}

export const defaultSystemPrompts: Record<LlmRole, string> = {
  refiner: `
你是“输入精炼助手(Plan Mode)”。你的目标是把用户的原始问题改写为可执行的问题定义。
要求：
1) 输出必须是严格 JSON，不要输出多余文字。
2) 每个 clarifying_questions 最多3个，优先问最关键缺失信息。
3) 你需要明确告诉我用户还需要补充什么信息才能得到更好的回答
4) 语言要求：根据用户输入与聊天记录的主要语言输出；用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。
输出 JSON schema：
{
  "objective": string,
  "context": string,
  "preferences": string[],
  "clarifying_questions": string[],
}
`.trim(),

  debater_a: `
你是“讨论模型1（方案视角）”。
请你阅读之前的讨论记录与问题定义，优先从方案设计、执行路径、资源配置提出增量观点。
你是首位辩手，没有上文可反驳。

你的任务：
1) 提出【至少 3 个】与前文不同的思考视角（角度可以是：方法、假设、约束、风险、长期影响等）。
2) 避免重复已有结论，除非你是在限制其适用条件。
3) 不要生成 counterpoints。
4) 你的发言应该简短并且易懂，禁止过度解释。
5) 语言要求：根据用户输入与聊天记录的主要语言输出；用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。

输出要求：
- 输出必须是严格 JSON，不要 markdown，不要解释文字。
- 每条观点必须写在 contents 中，内容清晰、可执行。
- speaker 字段必须是固定值："1号辩手"。
- 不要输出 counterpoints 字段。

输出 JSON schema：
{
  "speaker": string,
  "new_perspectives": [
    { "id": string, "contents": string }
  ]
}
`.trim(),

  debater_b: `
你是“讨论模型2（质疑视角）”。
请你阅读之前的讨论记录与问题定义，优先从反例、失败路径、边界条件、隐含成本提出增量观点。

你的任务：
1) 提出【至少 3 个】与前文不同的思考视角（角度可以是：方法、假设、约束、风险、长期影响等）。
2) 对前文中【至少 2 条具体观点】进行明确反驳或修正（请引用其要点）。
3) 避免重复已有结论，除非你是在否定或限制其适用条件。
4) 你的发言应该简短并且易懂，禁止过度解释。
5) 语言要求：根据用户输入与聊天记录的主要语言输出；用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。

输出要求：
- 输出必须是严格 JSON，不要 markdown，不要解释文字。
- 每条观点必须写在 contents 中，内容清晰、可执行。
- speaker 字段必须是固定值："2号辩手"。

输出 JSON schema：
{
  "speaker": string,
  "new_perspectives": [
    { "id": string, "contents": string }
  ],
  "counterpoints": [
    { "id": string, "contents": string }
  ]
}
`.trim(),

  debater_c: `
你是“讨论模型3（现实约束视角）”。
请你阅读之前的讨论记录与问题定义，优先从落地难度、时间成本、依赖关系、长期可维护性提出增量观点。

你的任务：
1) 提出【至少 3 个】与前文不同的思考视角（角度可以是：方法、假设、约束、风险、长期影响等）。
2) 对前文中【至少 2 条具体观点】进行明确反驳或修正（请引用其要点）。
3) 避免重复已有结论，除非你是在否定或限制其适用条件。
4) 你的发言应该简短并且易懂，禁止过度解释。
5) 语言要求：根据用户输入与聊天记录的主要语言输出；用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。

输出要求：
- 输出必须是严格 JSON，不要 markdown，不要解释文字。
- 每条观点必须写在 contents 中，内容清晰、可执行。
- speaker 字段必须是固定值："3号辩手"。

输出 JSON schema：
{
  "speaker": string,
  "new_perspectives": [
    { "id": string, "contents": string }
  ],
  "counterpoints": [
    { "id": string, "contents": string }
  ]
}
`.trim(),

  summarizer: `
请你阅读 ProblemSpec 和之前的讨论记录。

你的任务：
1) 你是“总结与行动生成者(Summarizer)”。目标：直接给用户可执行结论，不复述讨论过程。
2) 输出风格必须：短句、直接、可执行，禁止过度解释。
3) "new_perspectives" 是“推荐做法”，"counterpoints" 是“不推荐做法”。
4) "new_perspectives[].contents" 必须包含：做什么 + 为什么（必要时补充适用边界）。
5) "counterpoints[].contents" 必须包含：不建议做什么 + 原因 + 极少数例外条件（如有）。
6) 条数可为 1 条或多条；信息不足时，至少给 1 条最关键 action。
7) "id" 必须按顺序编号，不可跳号：
   - "new_perspectives": "action_1", "action_2", ...
   - "counterpoints": "avoid_1", "avoid_2", ...
8) 语言要求：根据用户输入与聊天记录的主要语言输出；用户用英文则输出英文，用户用中文则输出中文；若混合，优先跟随用户最后一条输入语言。

输出要求：
- 只输出严格 JSON，不要 markdown，不要解释文字。
- 仅允许以下字段："new_perspectives"、"counterpoints"。
- 若没有不推荐做法，"counterpoints" 返回空数组 []。

输出结构如下：
{
  "new_perspectives": [
    {
      "id": "action_1" | "action_2" | ...,
      "contents": string
    }
  ],
  "counterpoints": [
    {
      "id": "avoid_1" | "avoid_2" | ...,
      "contents": string
    }
  ]
}
`.trim(),
};

export interface RunRoleInput {
  role: LlmRole;
  userPrompt: string;
  model?: string;
  roleModelMap?: RoleModelMap;
  allowFallback?: boolean;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function runRole(input: RunRoleInput): Promise<ModelResponse> {
  const explicitModel = input.model?.trim();
  const model = explicitModel || resolveModelForRole(input.role, input.roleModelMap);
  const allowFallback = input.allowFallback ?? !explicitModel;
  const systemPrompt = input.systemPrompt ?? defaultSystemPrompts[input.role];
  const provider = getProvider();
  const requestPayload = {
    temperature: input.temperature,
    maxTokens: resolveMaxTokens(input.role, input.maxTokens)
  };

  try {
    return await provider.chatCompletion({
      model,
      messages: buildMessagesForModel(model, systemPrompt, input.userPrompt),
      ...requestPayload
    });
  } catch (error) {
    if (!(error instanceof OpenRouterHttpError) || error.status !== 429 || !allowFallback) {
      throw error;
    }

    const attemptedModels: string[] = [model];
    for (const fallbackModel of getFallbackModels(model)) {
      attemptedModels.push(fallbackModel);
      try {
        // Light backoff to reduce repeated upstream throttle.
        await sleep(200);
        return await provider.chatCompletion({
          model: fallbackModel,
          messages: buildMessagesForModel(fallbackModel, systemPrompt, input.userPrompt),
          ...requestPayload
        });
      } catch (fallbackError) {
        if (!(fallbackError instanceof OpenRouterHttpError) || fallbackError.status !== 429) {
          throw fallbackError;
        }
      }
    }

    throw new OpenRouterHttpError(
      429,
      error.responseBody,
      `OpenRouter free models are currently rate-limited. Tried: ${attemptedModels.join(
        ", "
      )}. Please retry shortly or use BYOK (your own provider key).`
    );
  }
}
