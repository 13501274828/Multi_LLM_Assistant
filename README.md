# Multi-LLM Assistant (MVP Bootstrap)

This is the initial Next.js bootstrap with OpenRouter as the model provider interface.

## 1. Install

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env.local
```

Required:

- `OPENROUTER_API_KEY`

Optional but recommended:

- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_X_TITLE`
- `OPENROUTER_MODELS` (comma-separated model pool shown in UI and used for fallback)
- `OPENROUTER_EXTRA_MODELS` (append extra backup models)
- `OPENROUTER_MAX_TOKENS_CAP` and `OPENROUTER_MAX_TOKENS_<ROLE>` (backend token limits)

## 3. Run

```bash
npm run dev
```

Open:

- UI: `http://localhost:3000`
- Debate step page: `http://localhost:3000/debate`
- Health: `GET http://localhost:3000/api/health`
- Models: `GET http://localhost:3000/api/llm/models`
- LLM test: `POST http://localhost:3000/api/llm/test`

Workflow:

1. `/` 输入原始问题 + 选择规划师模型，生成后自动跳转到 `/debate`
2. `/debate` 展示规划师完整输出，用户手动重写正式 prompt
3. 第一轮：3 个 debater 按 `A→B→C` 串行调用（失败不中断）
4. 第一轮后可选填写一次 addendum（补充信息）；该信息会作为独立 block 注入第二轮与后续总结
5. 第二轮（可选，最多两轮）：A/B/C 读取第一轮三个模型的解析后 `contents`，同轮仍串行
6. debater 输出包含结构化 `speaker` 字段（1号/2号/3号辩手），页面仅展示 `contents`
7. 模型1使用轮次化 prompt：第一轮不输出 `counterpoints`，第二轮输出 `counterpoints`
8. 仅在第一轮后可“跳过第二轮直接总结”；一旦进入第二轮，需完成第二轮后再总结
9. 仅在总结成功后，前端会将会话快照写入本地历史（`localStorage`），最多保留最近 3 条
10. 首页与辩论页均提供历史入口；点击会跳转到 `/debate?historyId=...` 的只读回看模式
11. 若触发 token/context 超限，前端会提示“上下文过长，请减少轮次或缩短输入后重试”

Model selection rule:

- user-selected request model > request roleModelMap > default role map > first model in `OPENROUTER_MODELS`
- if `model` is explicitly provided, fallback is disabled by default
- set `"allowFallback": true` in `/api/llm/test` body to enable cross-model fallback on 429
- for `google/gemma-3-27b-it:free`, system prompt is auto-inlined into a user message

Token control rule (backend):

- frontend request no longer controls `maxTokens` for `/api/llm/test`
- backend decides from:
  - `OPENROUTER_MAX_TOKENS_CAP`
  - `OPENROUTER_MAX_TOKENS_REFINER`
  - `OPENROUTER_MAX_TOKENS_DEBATER_A|B|C`
  - `OPENROUTER_MAX_TOKENS_SUMMARIZER`

Model pool config entrypoint:

- edit `OPENROUTER_MODELS` in `.env.local`, e.g.
  `OPENROUTER_MODELS=openai/gpt-oss-120b:free,qwen/qwen3-next-80b-a3b-instruct:free,deepseek/deepseek-v3.2`
- edit `OPENROUTER_EXTRA_MODELS` in `.env.local`, e.g.
  `OPENROUTER_EXTRA_MODELS=deepseek/deepseek-v3.2,openai/gpt-4.1-mini`

## 4. Example request

```bash
curl -X POST http://localhost:3000/api/llm/test \
  -H "Content-Type: application/json" \
  -d '{
    "role": "refiner",
    "model": "qwen/qwen3-next-80b-a3b-instruct:free",
    "prompt": "帮我把“我要学AI”改写为可执行问题",
    "temperature": 0.3
  }'
```
