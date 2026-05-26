import type { AIProvider, AnalyzeResult } from "../provider.ts";
import type { Env } from "../env.ts";
import { PROMPTS } from "../prompts.ts";
import { matchSpans, type RawItem } from "../match-spans.ts";

/**
 * Google Gemini provider.
 *
 * Workers AI llama-3.1-8b 가 한국 정치/일반 문장의 자극적 표현·핵심 문맥 검출에서
 * 0개 결과를 내는 한계가 확인돼 도입 (2026-05-21).
 *
 * - API: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * - JSON 형식 강제: generationConfig.response_mime_type = "application/json"
 * - 키는 wrangler secret 으로 주입 (GEMINI_API_KEY)
 *
 * 추천 모델: gemini-2.0-flash 또는 gemini-1.5-flash (한국어 강하고 빠름).
 */
export const geminiProvider: AIProvider = {
  async analyze(env, args): Promise<AnalyzeResult> {
    const t0 = Date.now();
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing — wrangler secret put GEMINI_API_KEY");

    const prompt = PROMPTS[args.kind];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: "user", parts: [{ text: args.text }] }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json",
        // Gemini 3.x thinking mode 응답 잘림 대응 (2026-05-26):
        //   - maxOutputTokens 는 *thought+text 합산 캡* (실측). thinkingBudget 의 2배 이상.
        //   - includeThoughts: false 로 응답에서 thought signature 제외.
        // Pro 모델은 thinking 많이 함 + 본문 길면 items 15개+ 출력 → 둘 다 넉넉히.
        maxOutputTokens: 16384,
        thinkingConfig: {
          thinkingBudget: 8192,
          includeThoughts: false,
        },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`gemini ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const items = parseItemsLoose(raw);
    const spans = matchSpans(args.text, items, args.kind);

    return { spans, model: args.model, elapsedMs: Date.now() - t0 };
  },
};

/**
 * Gemini 는 response_mime_type=json 으로 강제해도 가끔 마크다운 펜스나
 * 빈 텍스트를 반환한다. 첫 '{' 부터 마지막 '}' 까지 잘라 JSON.parse.
 */
function parseItemsLoose(raw: string): RawItem[] {
  if (!raw) return [];
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return [];
  try {
    const obj = JSON.parse(raw.slice(first, last + 1)) as { items?: unknown };
    if (!Array.isArray(obj.items)) return [];
    return obj.items.filter(
      (x): x is RawItem =>
        typeof x === "object" && x !== null && typeof (x as RawItem).text === "string",
    );
  } catch {
    return [];
  }
}
