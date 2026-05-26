import type { AIProvider, AnalyzeArgs, AnalyzeResult } from "../provider.ts";
import type { Env } from "../env.ts";
import { PROMPTS } from "../prompts.ts";
import { matchSpans } from "../match-spans.ts";
import type { RawItem } from "../match-spans.ts";

export const workersAIProvider: AIProvider = {
  async analyze(env, args): Promise<AnalyzeResult> {
    const t0 = Date.now();
    const prompt = PROMPTS[args.kind];

    const response = await env.AI.run(args.model as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: args.text },
      ],
      // 긴 본문 대응 — 모델별 한도(보통 ~4096)에 맞춰 큼지막하게. (specs/05)
      max_tokens: 4096,
      temperature: 0.1,
    }) as unknown;

    const raw = extractText(response);
    const items = parseItemsLoose(raw);
    const spans = matchSpans(args.text, items, args.kind);
    return { spans, model: args.model, elapsedMs: Date.now() - t0 };
  },
};

/**
 * Workers AI 모델별 응답 schema 가 일관되지 않다. 후보:
 *   { response: "..." }                                 — llama-3.1-8b 등
 *   { response: { response: "..." } }                   — 일부 모델 wrap
 *   { result: { response: "..." } } / OpenAI-compat 변형
 *   { response: { items: [...] } }                      — llama-3.3-70b 가 객체 직접 반환
 * 첫 string 을 찾아 반환. 객체가 직접 반환된 경우 JSON.stringify.
 *
 * detect-article 핸들러에서도 동일한 schema 흡수가 필요해 export.
 */
export function extractText(r: unknown): string {
  if (typeof r === "string") return r;
  if (r === null || typeof r !== "object") return "";
  const obj = r as Record<string, unknown>;
  if (typeof obj.response === "string") return obj.response;
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const c0 = obj.choices[0] as { message?: { content?: unknown }; text?: unknown };
    if (typeof c0?.text === "string") return c0.text;
    if (typeof c0?.message?.content === "string") return c0.message.content;
  }
  if (typeof obj.response === "object" && obj.response !== null) {
    const inner = obj.response as { response?: unknown };
    if (typeof inner.response === "string") return inner.response;
    return JSON.stringify(obj.response);
  }
  if (typeof obj.result === "object" && obj.result !== null) {
    return extractText(obj.result);
  }
  return "";
}

/**
 * LLM 출력 파서. 모델이 JSON 만 출력하라고 시켜도 종종 마크다운 펜스 ```json 을 두르거나
 * 앞뒤에 잡설을 붙인다. 첫 '{' 부터 마지막 '}' 까지를 추출해 JSON.parse.
 */
function parseItemsLoose(raw: string): RawItem[] {
  if (!raw) return [];
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return [];
  const slice = raw.slice(first, last + 1);
  try {
    const obj = JSON.parse(slice) as { items?: unknown };
    if (!Array.isArray(obj.items)) return [];
    return obj.items.filter((x): x is RawItem =>
      typeof x === "object" && x !== null && typeof (x as RawItem).text === "string",
    );
  } catch {
    return [];
  }
}
