import { NextResponse } from "next/server";
import {
  DEFAULT_ROLE_MODEL_MAP,
  getAvailableModels,
  resolveModelForRole
} from "@/lib/llm/model-config";
import { LLM_ROLES, LlmRole } from "@/lib/llm/types";

export async function GET() {
  const effectiveRoleModels = Object.fromEntries(
    LLM_ROLES.map((role) => [role, resolveModelForRole(role)])
  ) as Record<LlmRole, string>;

  return NextResponse.json({
    ok: true,
    data: {
      roles: LLM_ROLES,
      availableModels: getAvailableModels(),
      defaultRoleModels: DEFAULT_ROLE_MODEL_MAP,
      effectiveRoleModels
    }
  });
}
