import { NextResponse } from "next/server";
import { runRole } from "@/lib/llm/service";
import { isAllowedModel } from "@/lib/llm/model-config";
import { OpenRouterHttpError } from "@/lib/llm/providers/openrouter";
import { LLM_ROLES, LlmRole, RoleModelMap } from "@/lib/llm/types";

type TestRequestBody = {
  role?: LlmRole;
  model?: string;
  roleModelMap?: RoleModelMap;
  allowFallback?: boolean;
  prompt?: string;
  systemPrompt?: string;
  temperature?: number;
};

function isValidRole(value: string): value is LlmRole {
  return LLM_ROLES.includes(value as LlmRole);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TestRequestBody;
    const role = body.role ?? "refiner";
    const prompt = body.prompt?.trim();

    if (!isValidRole(role)) {
      return NextResponse.json(
        { ok: false, error: `Invalid role: ${role}` },
        { status: 400 }
      );
    }

    if (!prompt) {
      return NextResponse.json(
        { ok: false, error: "prompt is required" },
        { status: 400 }
      );
    }

    const model = body.model?.trim();
    if (model && !isAllowedModel(model)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported model: ${model}. Please choose a model from /api/llm/models`
        },
        { status: 400 }
      );
    }

    if (body.roleModelMap) {
      const invalidRoleEntry = Object.entries(body.roleModelMap).find(
        ([, modelId]) => typeof modelId === "string" && !isAllowedModel(modelId)
      );

      if (invalidRoleEntry) {
        return NextResponse.json(
          {
            ok: false,
            error: `Unsupported model in roleModelMap: ${invalidRoleEntry[1]}`
          },
          { status: 400 }
        );
      }
    }

    const result = await runRole({
      role,
      model,
      roleModelMap: body.roleModelMap,
      allowFallback: body.allowFallback,
      userPrompt: prompt,
      systemPrompt: body.systemPrompt,
      temperature: body.temperature
    });

    return NextResponse.json({
      ok: true,
      data: {
        role,
        model: result.model,
        content: result.content
      }
    });
  } catch (error) {
    if (error instanceof OpenRouterHttpError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          details: error.responseBody.slice(0, 400)
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error"
      },
      { status: 500 }
    );
  }
}
