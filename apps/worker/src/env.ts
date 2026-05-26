import type { AnalysisKind } from "@newtrospect/core/server";

export interface Env {
  AI: Ai;
  DB: D1Database;

  PROVIDER_TERM: string;
  PROVIDER_SENSATIONAL: string;
  PROVIDER_QUANTITATIVE: string;
  PROVIDER_CONTEXT: string;
  PROVIDER_DETECT: string;
  /** specs/01 카드 3장 — 외부 지식·추론 부담 큼. */
  PROVIDER_BRIEFING: string;
  /** specs/01 한 줄 요약 — 본문 압축, 가벼움. */
  PROVIDER_ONELINE: string;
  /** specs/04 글 성격 7신호 — 분류 부담 가벼움. */
  PROVIDER_CHARACTER: string;
  /** specs/03 자극→온화 변환 — 1문장 재작성. */
  PROVIDER_REWRITE: string;

  MODEL_TERM: string;
  MODEL_SENSATIONAL: string;
  MODEL_QUANTITATIVE: string;
  MODEL_CONTEXT: string;
  MODEL_DETECT: string;
  MODEL_BRIEFING: string;
  MODEL_ONELINE: string;
  MODEL_CHARACTER: string;
  MODEL_REWRITE: string;

  CACHE_TTL_SEC: string;

  /** Gemini provider 사용 시 필요 — wrangler secret put GEMINI_API_KEY */
  GEMINI_API_KEY?: string;
}

const PROVIDER_KEY = {
  term: "PROVIDER_TERM",
  sensational: "PROVIDER_SENSATIONAL",
  quantitative: "PROVIDER_QUANTITATIVE",
  context: "PROVIDER_CONTEXT",
} as const satisfies Record<AnalysisKind, keyof Env>;

const MODEL_KEY = {
  term: "MODEL_TERM",
  sensational: "MODEL_SENSATIONAL",
  quantitative: "MODEL_QUANTITATIVE",
  context: "MODEL_CONTEXT",
} as const satisfies Record<AnalysisKind, keyof Env>;

export function providerFor(env: Env, kind: AnalysisKind): string {
  return env[PROVIDER_KEY[kind]] as string;
}

export function modelFor(env: Env, kind: AnalysisKind): string {
  return env[MODEL_KEY[kind]] as string;
}

export function detectProvider(env: Env): string {
  return env.PROVIDER_DETECT;
}

export function detectModel(env: Env): string {
  return env.MODEL_DETECT;
}

export function briefingProvider(env: Env): string {
  return env.PROVIDER_BRIEFING;
}

export function briefingModel(env: Env): string {
  return env.MODEL_BRIEFING;
}

export function onelineProvider(env: Env): string {
  return env.PROVIDER_ONELINE;
}

export function onelineModel(env: Env): string {
  return env.MODEL_ONELINE;
}

export function characterProvider(env: Env): string {
  return env.PROVIDER_CHARACTER;
}

export function characterModel(env: Env): string {
  return env.MODEL_CHARACTER;
}

export function rewriteProvider(env: Env): string {
  return env.PROVIDER_REWRITE;
}

export function rewriteModel(env: Env): string {
  return env.MODEL_REWRITE;
}

export function cacheTtlSec(env: Env): number {
  return Number(env.CACHE_TTL_SEC) || 3600;
}
