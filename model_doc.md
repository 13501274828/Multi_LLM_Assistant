# multi-llm-assistant Architecture Overview

## Project Goals

`multi-llm-assistant` is designed as a multi-model collaboration system built on top of OpenRouter.

Primary goals:

- Connect multiple LLMs and let users choose models dynamically.
- Split one user task into role-based stages: `refiner -> debater_a/b/c -> summarizer`.
- Support structured outputs and multi-round debate (currently up to 2 rounds).
- Let users add post-Round-1 addendum context before entering Round 2.
- Keep outputs language-adaptive to the user's input language.
- Provide bilingual web UI (Chinese/English) with runtime switching.
- Save conversation history locally only after summary succeeds, with max 3 records per browser.
- Keep provider keys server-side while controlling prompts, routing, token limits, and fallback behavior in the backend.

Current positioning is **MVP with an extensible core**: validate workflow quality first, then evolve toward stronger orchestration and persistence.

## High-Level Architecture

The project uses a single-repo Next.js architecture with clear runtime layers:

1. **Web Layer (UI)**
   - Pages: `src/app/page.tsx`, `src/app/debate/page.tsx`
   - Responsibilities: user input, workflow state transitions, incremental result rendering, bilingual UI switching.

2. **BFF/API Layer (Next.js Route Handlers)**
   - Routes: `src/app/api/llm/models/route.ts`, `src/app/api/llm/test/route.ts`, `src/app/api/health/route.ts`
   - Responsibilities: request validation, model allowlist checks, normalized error responses, server-side boundary for secrets.

3. **Model Invocation Layer**
   - Orchestration service: `src/lib/llm/service.ts`
   - Model policy/config: `src/lib/llm/model-config.ts`
   - Provider adapter: `src/lib/llm/providers/openrouter.ts`
   - Responsibilities: prompt templates, role-based token policy, capability adaptation, fallback on throttling.

4. **Workflow Session Layer (Frontend)**
   - `src/lib/workflow/refine-session.ts`
   - Stores Step 1 result in `sessionStorage` and transfers it to the debate page.

Conceptually:

`Browser UI -> Next.js BFF -> LLM Service -> OpenRouter Provider -> Vendor Model`

## Core Modules

### 1) Web Layer

#### `src/app/page.tsx` (Step 1: Refiner)

- Loads available models via `GET /api/llm/models`.
- Accepts user raw prompt and selected refiner model.
- Calls `POST /api/llm/test` with `role=refiner`.
- Saves refiner output into session storage and navigates to `/debate`.

#### `src/app/debate/page.tsx` (Step 2+: Debate & Summary)

- Loads Step 1 context from session storage.
- Lets user rewrite the final prompt.
- Runs round-based serial debate flow (`A -> B -> C`) with non-blocking failure handling.
- Supports optional Round 2 with context chaining.
- Supports optional post-Round-1 addendum input:
  - `round2AddendumDraft` (editable user input)
  - `round2AddendumCommitted` (snapshot locked when Round 2 starts)
- Injects addendum as an explicit block into Round 2 prompts and summary prompts.
- Shows summary section conditionally based on workflow stage.
- Parses structured model output and displays `contents` fields for readability.
- Supports bilingual UI wording via local state + localStorage persistence.
- Supports local history replay mode via `historyId` query parameter (`/debate?historyId=...`).

### 2) API/BFF Layer

#### `GET /api/llm/models`

- Returns roles, available model pool, default role-model map, and effective role-model map.
- Backed by `model-config.ts` and environment variables.

#### `POST /api/llm/test`

- Unified role-based model call endpoint.
- Validates role and model legality (`isAllowedModel`).
- Invokes `runRole(...)` in service layer.
- Returns normalized JSON errors to avoid HTML error pages in frontend clients.

#### `GET /api/health`

- Lightweight health check endpoint.

### 3) Model Invocation Layer

#### `src/lib/llm/service.ts`

- Central role execution service.
- Holds default system prompts for each role.
- Enforces language-following output rule in role prompts (respond in the user's primary language context).
- Enforces per-role max token settings with global cap.
- Applies provider capability handling:
  - If model supports system prompt: send `system + user` messages.
  - If not (e.g., gemma): inline system instruction into user message.
- Handles 429 throttling with fallback across configured model pool when enabled.

#### `src/lib/llm/model-config.ts`

- Defines base model pool and env-based extensions.
- Supports:
  - `OPENROUTER_MODELS`
  - `OPENROUTER_EXTRA_MODELS`
- Provides default role-model mapping and role model resolution.
- Exposes system-prompt capability checks per model family.

#### `src/lib/llm/providers/openrouter.ts`

- OpenRouter adapter implementation of provider interface.
- Handles auth, headers, request body serialization, and response parsing.
- Normalizes provider errors into `OpenRouterHttpError` with status + body.

### 4) Shared Types

`src/lib/llm/types.ts` defines role enums, chat message contracts, request/response interfaces, and provider abstraction.

This keeps UI, API, and provider layers type-aligned.

## Web Layer vs Model Invocation Layer

Current architecture uses **frontend workflow orchestration + backend execution governance**.

- Frontend controls interaction state and stage transitions.
- Backend controls security boundaries, request validation, prompt/runtime policy, and provider adaptation.

Benefits:

- Fast product iteration (UI + prompt strategy can evolve quickly).
- API keys remain server-side.
- Provider-specific complexity is isolated in adapter/service layers.

Trade-offs:

- Workflow complexity currently lives mostly in page-level code.
- No durable server-side conversation persistence yet.
- Limited observability compared to dedicated orchestration services.

## Request Flow (Textual)

### A. Refiner Stage

1. User submits raw prompt on `/`.
2. Frontend calls `POST /api/llm/test` (`role=refiner`).
3. BFF validates input and calls `runRole(...)`.
4. Service builds messages/token policy and calls OpenRouter provider.
5. Result returns to frontend and is saved to session storage.
6. Frontend navigates to `/debate`.

### B. Debate Stage (Serial)

1. User submits final prompt and picks 3 debate models.
2. Round 1 runs in strict order: A -> B -> C.
3. Context chaining:
   - B sees A parsed contents.
   - C sees A + B parsed contents.
4. After Round 1, user may provide optional addendum context.
5. If user starts Round 2, addendum is snapshotted (`round2AddendumCommitted`) and locked.
6. Round 2 (optional) reuses:
   - Round 1 valid parsed outputs
   - Current round predecessors
   - Locked addendum block (if provided)
7. Failures are recorded per debater; remaining debaters continue.

### C. Summary Stage

1. After Round 1, user can skip Round 2 and summarize immediately.
2. If Round 2 starts, summary section is hidden until Round 2 completes.
3. Summary prompt includes addendum context:
   - Skip Round 2 path: uses current draft addendum.
   - Two-round path: uses locked addendum snapshot from Round 2 start.
4. Frontend builds summary prompt from selected rounds and calls `POST /api/llm/test` with `role=summarizer`.
5. Summarizer returns structured JSON actions/counterpoints for display.
6. Only after successful summary, frontend stores the full conversation snapshot to local history and keeps at most 3 latest records.

## Why This Architecture (Design Choices)

### Choice 1: Next.js as both Web and BFF

- **Why**: fewer moving parts, fast MVP iteration, simpler deployment.
- **Cost**: backend concerns and UI lifecycle share the same runtime project.

### Choice 2: Frontend-managed debate orchestration (for now)

- **Why**: prompt/workflow experimentation is faster.
- **Why**: UI-specific stage controls (round start/skip/lock addendum, bilingual wording) are easy to iterate in one place.
- **Cost**: orchestration logic in page components grows with feature complexity.

### Choice 3: Provider abstraction + OpenRouter adapter

- **Why**: separates role logic from vendor protocol.
- **Cost**: currently only one concrete provider is implemented.

### Choice 4: Env-driven model pool and token policy

- **Why**: operationally flexible without code release.
- **Cost**: no centralized config UI/audit trail yet.

## Scalability and Future Evolution

Recommended next steps:

1. **Move orchestration to backend workflow APIs**
   - Add endpoints like `/api/workflows/debate`.
   - Keep frontend as view/controller only.

2. **Add persistent storage**
   - Store sessions, rounds, model outputs, token usage, and errors.
   - Enable replay, resume, and analytics.

3. **Strengthen structured output governance**
   - Add server-side schema validation (e.g., Zod).
   - Add repair/retry loop for malformed JSON.

4. **Improve observability and cost control**
   - Track per-role latency, retries, token/cost metrics.
   - Add model quality/latency routing policies.

5. **Expand provider strategy**
   - Implement additional adapters under `ModelProvider`.
   - Add streaming responses for better UX on long generations.

6. **Enhance resilience**
   - Better retry/backoff profiles for 429/timeout.
   - Context compaction strategy for long multi-round debates.

## Current Boundaries and Assumptions

- No user auth/tenant isolation yet.
- Session state is primarily frontend (`sessionStorage` + in-memory state).
- API layer is single-call oriented; workflow orchestration is page-driven.
- Addendum is session-scoped and not persisted server-side.
- Bilingual wording is page-level i18n (not yet a centralized i18n resource system).
- Conversation history is browser-local (`localStorage`) and does not sync across devices/browsers.
- History replay is read-only and intended for summary snapshot review.
- Current priority is product correctness and iteration speed over enterprise-scale runtime guarantees.
