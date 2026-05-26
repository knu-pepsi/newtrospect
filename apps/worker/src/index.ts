import { Hono } from "hono";
import type {
  AnalysisKind,
  AnalyzeResponse,
  BriefingCard,
  BriefingResponse,
  CharacterLevel,
  CharacterResponse,
  CharacterSignalKey,
  DetectArticleResponse,
  OneLineResponse,
  RewriteSensationalResponse,
} from "@newtrospect/core/server";
import { CHARACTER_SIGNAL_ORDER, MIN_BODY_LENGTH, sha256Hex } from "@newtrospect/core/server";
import type { Env } from "./env.ts";
import {
  briefingModel,
  briefingProvider,
  cacheTtlSec,
  characterModel,
  characterProvider,
  detectModel,
  detectProvider,
  modelFor,
  onelineModel,
  onelineProvider,
  providerFor,
  rewriteModel,
  rewriteProvider,
} from "./env.ts";
import {
  logRequest,
  readCache,
  readDetectCache,
  readGenericCache,
  writeCache,
  writeDetectCache,
  writeGenericCache,
} from "./cache.ts";
import { workersAIProvider, extractText } from "./providers/workers-ai.ts";
import { geminiProvider } from "./providers/gemini.ts";
import type { AIProvider } from "./provider.ts";
import {
  BRIEFING_PROMPT,
  CHARACTER_PROMPT,
  DETECT_PROMPT,
  DETECT_SAMPLE_CP,
  ONELINE_PROMPT,
  REWRITE_SENSATIONAL_PROMPT,
} from "./prompts.ts";
import { privacyHtml } from "./privacy.ts";

const app = new Hono<{ Bindings: Env }>();

/**
 * CORS + Private Network Access 직접 처리.
 *
 * Chrome 의 PNA(Private Network Access) 기능 때문에 hono/cors 기본 응답으론
 * 공개 사이트(https://...) → 로컬 워커(127.0.0.1:8787) 요청이 차단된다.
 * 해결: preflight·실응답 모두에 Access-Control-Allow-Private-Network: true 를 추가.
 * (browser 가 ACR-Private-Network: true 헤더를 자동 보내며, 서버가 ACAP-PN 으로 화답해야 함)
 *
 * https://developer.chrome.com/blog/private-network-access-preflight/
 */
app.use("*", async (c, next) => {
  const origin = c.req.header("origin") ?? "*";
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": c.req.header("access-control-request-headers") ?? "content-type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }
  await next();
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Private-Network", "true");
  c.header("Vary", "Origin");
});

app.get("/privacy", (c) => {
  return c.html(privacyHtml(), 200, {
    "Cache-Control": "public, max-age=300",
  });
});

app.get("/", (c) => c.redirect("/privacy", 302));

app.get("/health", (c) => {
  const env = c.env;
  return c.json({
    ok: true,
    models: {
      term: modelFor(env, "term"),
      sensational: modelFor(env, "sensational"),
      quantitative: modelFor(env, "quantitative"),
      context: modelFor(env, "context"),
      detect: detectModel(env),
      briefing: briefingModel(env),
      oneline: onelineModel(env),
      character: characterModel(env),
      rewrite: rewriteModel(env),
    },
    cacheTtlSec: cacheTtlSec(env),
  });
});

/**
 * 본문 평문을 받아 (a) 뉴스 기사 여부 (b) 정제된 본문 반환.
 * URL fetch 는 하지 않는다 — 봇 차단·로그인 벽 회피 정책.
 *
 * 2026-05-21: 휴리스틱(길이)만 보던 것을 AI 판정으로 격상.
 * 셀렉터 dictionary 가 없는 사이트에서도 폴백 추출 + AI 판정으로 대응.
 * cleanedText 는 좌표 보존 위해 *입력 그대로 normalize* — AI 가 변형하지 않는다.
 */
app.post("/api/detect-article", (c) => handleDetect(c.env, c.req.raw));

const KINDS: readonly AnalysisKind[] = ["term", "sensational", "quantitative", "context"];
for (const kind of KINDS) {
  app.post(`/api/analyze/${kind === "term" ? "terms" : kind}`, (c) => handleAnalyze(c.env, c.req.raw, kind));
}

// specs/01 — 본문 위쪽 3장 카드 (외부 맥락, Pro 모델).
app.post("/api/analyze/briefing", (c) => handleBriefing(c.env, c.req.raw));
// specs/01 — 본문 아래 한 줄 요약 (본문 압축, flash 모델).
app.post("/api/analyze/oneline", (c) => handleOneline(c.env, c.req.raw));
// specs/04 — 글 성격 7신호.
app.post("/api/analyze/character", (c) => handleCharacter(c.env, c.req.raw));
// specs/03 — 자극적 문장 1개를 온화한 표현으로 변환.
app.post("/api/rewrite/sensational", (c) => handleRewriteSensational(c.env, c.req.raw));

async function handleDetect(env: Env, req: Request): Promise<Response> {
  const reqOrigin = req.headers.get("origin");
  const host = parseHost(reqOrigin);

  const body = (await req.json().catch(() => ({}))) as { text?: string; url?: string };
  const text = (body.text ?? "").trim();
  const cleaned = text.replace(/\s+/g, " ").trim();

  if (cleaned.length < MIN_BODY_LENGTH) {
    await logRequest(env, { host, kind: "detect", model: null, elapsedMs: null, statusCode: 200, cacheHit: false });
    return Response.json({
      isArticle: false,
      cleanedText: "",
      reason: `본문이 ${MIN_BODY_LENGTH}자 미만 (단신·페이월·UI 텍스트 추정)`,
    });
  }

  const bodyHash = await sha256Hex(cleaned);
  const cached = await readDetectCache(env, bodyHash);
  if (cached) {
    await logRequest(env, { host, kind: "detect", model: null, elapsedMs: null, statusCode: 200, cacheHit: true });
    return Response.json(cached);
  }

  const provider = detectProvider(env);
  if (provider !== "workers-ai" && provider !== "gemini") {
    await logRequest(env, { host, kind: "detect", model: null, elapsedMs: null, statusCode: 500, cacheHit: false });
    return Response.json({ error: "detect_provider_not_supported" }, { status: 500 });
  }

  const model = detectModel(env);
  const t0 = Date.now();
  const sample = sliceCp(cleaned, DETECT_SAMPLE_CP);

  try {
    const text = provider === "gemini"
      ? await runDetectGemini(env, model, sample)
      : await runDetectWorkersAI(env, model, sample);
    const parsed = parseDetect(text);
    const elapsedMs = Date.now() - t0;
    const response: DetectArticleResponse = {
      isArticle: parsed.isArticle,
      cleanedText: parsed.isArticle ? cleaned : "",
      reason: parsed.reason,
    };
    await writeDetectCache(env, bodyHash, model, response, cacheTtlSec(env));
    await logRequest(env, { host, kind: "detect", model, elapsedMs, statusCode: 200, cacheHit: false });
    return Response.json(response);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error(`[detect] model=${model} host=${host ?? "?"} err=${rawMsg}`);
    await logRequest(env, { host, kind: "detect", model, elapsedMs: null, statusCode: 500, cacheHit: false });
    // 안전한 폴백 — AI 호출 실패 시엔 길이 기반 휴리스틱으로 일단 통과시킴.
    // 분석 endpoint 가 어차피 한 번 더 검증한다.
    return Response.json({
      isArticle: true,
      cleanedText: cleaned,
      reason: "ai_unavailable_heuristic_pass",
    });
  }
}

async function handleAnalyze(env: Env, req: Request, kind: AnalysisKind): Promise<Response> {
  const reqOrigin = req.headers.get("origin");
  const host = parseHost(reqOrigin);

  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (text.length < MIN_BODY_LENGTH) {
    await logRequest(env, { host, kind, model: null, elapsedMs: null, statusCode: 400, cacheHit: false });
    return Response.json({ error: "text too short" }, { status: 400 });
  }

  const bodyHash = await sha256Hex(text);
  const cached = await readCache(env, bodyHash, kind);
  if (cached) {
    await logRequest(env, { host, kind, model: cached.model, elapsedMs: cached.elapsedMs, statusCode: 200, cacheHit: true });
    return Response.json(cached);
  }

  const providerName = providerFor(env, kind);
  const model = modelFor(env, kind);
  const provider = resolveProvider(providerName);
  if (!provider) {
    await logRequest(env, { host, kind, model, elapsedMs: null, statusCode: 500, cacheHit: false });
    return Response.json({ error: "provider_not_found" }, { status: 500 });
  }

  try {
    const result = await provider.analyze(env, { kind, text, model });
    const response: AnalyzeResponse = { spans: result.spans, model: result.model, elapsedMs: result.elapsedMs };
    await writeCache(env, bodyHash, kind, response, cacheTtlSec(env));
    await logRequest(env, { host, kind, model: result.model, elapsedMs: result.elapsedMs, statusCode: 200, cacheHit: false });
    return Response.json(response);
  } catch (err) {
    // raw 에러 메시지(Cloudflare 내부 에러 코드·모델 path 등) 는 클라이언트에 노출하지 않는다.
    // 자세한 원인은 wrangler tail / D1 request_log 에서 추적.
    const raw = err instanceof Error ? err.message : String(err);
    console.error(`[analyze:${kind}] model=${model} host=${host ?? "?"} err=${raw}`);
    await logRequest(env, { host, kind, model, elapsedMs: null, statusCode: 500, cacheHit: false });
    return Response.json({ error: "analyze_failed", kind }, { status: 500 });
  }
}

function resolveProvider(name: string): AIProvider | null {
  if (name === "workers-ai") return workersAIProvider;
  if (name === "gemini") return geminiProvider;
  return null;
}

function parseHost(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

async function runDetectWorkersAI(env: Env, model: string, sample: string): Promise<string> {
  const raw = await env.AI.run(model as Parameters<Ai["run"]>[0], {
    messages: [
      { role: "system", content: DETECT_PROMPT },
      { role: "user", content: sample },
    ],
    max_tokens: 96,
    temperature: 0.1,
  });
  return extractText(raw);
}

async function runDetectGemini(env: Env, model: string, sample: string): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing — wrangler secret put GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: DETECT_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: sample }] }],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json",
      maxOutputTokens: 128,
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
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

function sliceCp(s: string, n: number): string {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n).join("");
}

/** detect AI 응답 파서 — JSON 외 잡설을 관용적으로 처리. */
function parseDetect(raw: string): { isArticle: boolean; reason?: string } {
  if (!raw) return { isArticle: false, reason: "ai_empty_response" };
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    // JSON 형식이 아니면 보수적으로 통과 — 다음 단계(분석)가 한 번 더 검증.
    return { isArticle: true, reason: "ai_unparseable_pass" };
  }
  try {
    const obj = JSON.parse(raw.slice(first, last + 1)) as { isArticle?: unknown; reason?: unknown };
    const isArticle = obj.isArticle === true;
    const reason = typeof obj.reason === "string" ? obj.reason : undefined;
    return { isArticle, reason };
  } catch {
    return { isArticle: true, reason: "ai_unparseable_pass" };
  }
}

/* ── specs/01 카드 3장 (briefing) ─────────────────────────────────────────── */

async function handleBriefing(env: Env, req: Request): Promise<Response> {
  const host = parseHost(req.headers.get("origin"));
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (text.length < MIN_BODY_LENGTH) {
    await logRequest(env, { host, kind: "briefing", model: null, elapsedMs: null, statusCode: 400, cacheHit: false });
    return Response.json({ error: "text too short" }, { status: 400 });
  }

  const bodyHash = await sha256Hex(text);
  const cached = await readGenericCache<BriefingResponse>(env, bodyHash, "briefing");
  if (cached) {
    await logRequest(env, { host, kind: "briefing", model: cached.model, elapsedMs: cached.elapsedMs, statusCode: 200, cacheHit: true });
    return Response.json({ ...cached, cached: true });
  }

  const providerName = briefingProvider(env);
  const model = briefingModel(env);
  const t0 = Date.now();

  try {
    // briefing 은 Pro 모델로 외부 지식 추론. maxOut 은 thought+text 합산 캡이므로
    // thinkingBudget 보다 2~3배 크게. (실측: flash 가 둘 합산으로 cap 적용 — 2026-05-26)
    const raw = await callAux(env, providerName, model, BRIEFING_PROMPT, text, 16384, 8192);
    const cards = parseBriefing(raw);
    if (!cards) throw new Error("briefing_parse_failed");
    const elapsedMs = Date.now() - t0;
    const response: BriefingResponse = { cards, model, elapsedMs };
    await writeGenericCache(env, bodyHash, "briefing", model, response, cacheTtlSec(env));
    await logRequest(env, { host, kind: "briefing", model, elapsedMs, statusCode: 200, cacheHit: false });
    return Response.json(response);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error(`[briefing] model=${model} host=${host ?? "?"} err=${rawMsg}`);
    await logRequest(env, { host, kind: "briefing", model, elapsedMs: null, statusCode: 500, cacheHit: false });
    return Response.json({ error: "briefing_failed" }, { status: 500 });
  }
}

/* ── specs/01 한 줄 요약 (oneline) ──────────────────────────────────────── */

async function handleOneline(env: Env, req: Request): Promise<Response> {
  const host = parseHost(req.headers.get("origin"));
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (text.length < MIN_BODY_LENGTH) {
    await logRequest(env, { host, kind: "oneline", model: null, elapsedMs: null, statusCode: 400, cacheHit: false });
    return Response.json({ error: "text too short" }, { status: 400 });
  }

  const bodyHash = await sha256Hex(text);
  const cached = await readGenericCache<OneLineResponse>(env, bodyHash, "oneline");
  if (cached) {
    await logRequest(env, { host, kind: "oneline", model: cached.model, elapsedMs: cached.elapsedMs, statusCode: 200, cacheHit: true });
    return Response.json({ ...cached, cached: true });
  }

  const providerName = onelineProvider(env);
  const model = onelineModel(env);
  const t0 = Date.now();

  try {
    // oneline 은 flash 모델 — maxOut 은 thought+text 합산 캡이라 thinkingBudget 의 2배 이상.
    const raw = await callAux(env, providerName, model, ONELINE_PROMPT, text, 2048, 1024);
    const oneLine = parseOneline(raw);
    if (!oneLine) throw new Error("oneline_parse_failed");
    const elapsedMs = Date.now() - t0;
    const response: OneLineResponse = { oneLine, model, elapsedMs };
    await writeGenericCache(env, bodyHash, "oneline", model, response, cacheTtlSec(env));
    await logRequest(env, { host, kind: "oneline", model, elapsedMs, statusCode: 200, cacheHit: false });
    return Response.json(response);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error(`[oneline] model=${model} host=${host ?? "?"} err=${rawMsg}`);
    await logRequest(env, { host, kind: "oneline", model, elapsedMs: null, statusCode: 500, cacheHit: false });
    return Response.json({ error: "oneline_failed" }, { status: 500 });
  }
}

/* ── specs/04 글 성격 7신호 ──────────────────────────────────────────────── */

async function handleCharacter(env: Env, req: Request): Promise<Response> {
  const host = parseHost(req.headers.get("origin"));
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (text.length < MIN_BODY_LENGTH) {
    await logRequest(env, { host, kind: "character", model: null, elapsedMs: null, statusCode: 400, cacheHit: false });
    return Response.json({ error: "text too short" }, { status: 400 });
  }

  const bodyHash = await sha256Hex(text);
  const cached = await readGenericCache<CharacterResponse>(env, bodyHash, "character");
  if (cached) {
    await logRequest(env, { host, kind: "character", model: cached.model, elapsedMs: cached.elapsedMs, statusCode: 200, cacheHit: true });
    return Response.json({ ...cached, cached: true });
  }

  const providerName = characterProvider(env);
  const model = characterModel(env);
  const t0 = Date.now();

  try {
    // character 는 flash 모델로 7개 카테고리 1~3 평가 — maxOut 은 합산 캡이라 충분히 크게.
    const raw = await callAux(env, providerName, model, CHARACTER_PROMPT, text, 4096, 2048);
    const signals = parseCharacter(raw);
    if (!signals) throw new Error("character_parse_failed");
    const elapsedMs = Date.now() - t0;
    const response: CharacterResponse = { signals, model, elapsedMs };
    await writeGenericCache(env, bodyHash, "character", model, response, cacheTtlSec(env));
    await logRequest(env, { host, kind: "character", model, elapsedMs, statusCode: 200, cacheHit: false });
    return Response.json(response);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error(`[character] model=${model} host=${host ?? "?"} err=${rawMsg}`);
    await logRequest(env, { host, kind: "character", model, elapsedMs: null, statusCode: 500, cacheHit: false });
    return Response.json({ error: "character_failed" }, { status: 500 });
  }
}

/* ── specs/03 자극적 → 온화 변환 ─────────────────────────────────────────── */

async function handleRewriteSensational(env: Env, req: Request): Promise<Response> {
  const host = parseHost(req.headers.get("origin"));
  const body = (await req.json().catch(() => ({}))) as { text?: string; reason?: string };
  const text = (body.text ?? "").trim();
  if (text.length < 4) {
    // 자극 문장 1개라 짧을 수 있음. 4자 미만이면 입력 오류로 간주.
    await logRequest(env, { host, kind: "rewrite_sens", model: null, elapsedMs: null, statusCode: 400, cacheHit: false });
    return Response.json({ error: "text too short" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  // 캐시 키: text + reason 함께 해시 (reason 이 변환 결과를 가르는 단서가 됨)
  const cacheKey = await sha256Hex(reason ? `${text}\n${reason}` : text);
  const cached = await readGenericCache<RewriteSensationalResponse>(env, cacheKey, "rewrite_sens");
  if (cached) {
    await logRequest(env, { host, kind: "rewrite_sens", model: cached.model, elapsedMs: cached.elapsedMs, statusCode: 200, cacheHit: true });
    return Response.json({ ...cached, cached: true });
  }

  const providerName = rewriteProvider(env);
  const model = rewriteModel(env);
  const t0 = Date.now();
  const userPayload = reason ? `<문장>${text}</문장>\n<이유>${reason}</이유>` : text;

  try {
    // rewrite 는 flash 모델로 1문장 재작성 — maxOut 은 thought+text 합산 캡.
    const raw = await callAux(env, providerName, model, REWRITE_SENSATIONAL_PROMPT, userPayload, 2048, 1024);
    const rewritten = parseRewrite(raw);
    if (!rewritten) throw new Error("rewrite_parse_failed");
    const elapsedMs = Date.now() - t0;
    const response: RewriteSensationalResponse = { rewritten, model, elapsedMs };
    await writeGenericCache(env, cacheKey, "rewrite_sens", model, response, cacheTtlSec(env));
    await logRequest(env, { host, kind: "rewrite_sens", model, elapsedMs, statusCode: 200, cacheHit: false });
    return Response.json(response);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error(`[rewrite_sens] model=${model} host=${host ?? "?"} err=${rawMsg}`);
    await logRequest(env, { host, kind: "rewrite_sens", model, elapsedMs: null, statusCode: 500, cacheHit: false });
    return Response.json({ error: "rewrite_failed" }, { status: 500 });
  }
}

/* ── 보조 분석 공통 호출 헬퍼 ─────────────────────────────────────────────── */

/**
 * span 반환이 아닌 *임의 JSON 문자열* 을 받아오는 보조 호출.
 * detect-article 의 Gemini/WorkersAI 분기를 일반화한 것.
 *
 * thinkingBudget: Gemini 3.x thinking mode 의 thought 토큰 한도. 별도로 명시 안 하면
 * thought 가 maxOutputTokens 를 다 먹고 text 응답이 잘림. 기본값은 호출별 권장값.
 */
async function callAux(
  env: Env,
  providerName: string,
  model: string,
  systemPrompt: string,
  userText: string,
  maxOutputTokens: number,
  thinkingBudget?: number,
): Promise<string> {
  if (providerName === "gemini") {
    return runGenericGemini(env, model, systemPrompt, userText, maxOutputTokens, thinkingBudget);
  }
  if (providerName === "workers-ai") {
    return runGenericWorkersAI(env, model, systemPrompt, userText, maxOutputTokens);
  }
  throw new Error(`provider_not_supported:${providerName}`);
}

async function runGenericGemini(
  env: Env,
  model: string,
  systemPrompt: string,
  userText: string,
  maxOutputTokens: number,
  thinkingBudget?: number,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing — wrangler secret put GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json",
      maxOutputTokens,
      // 호출별 명시 안 한 경우 maxOutputTokens 의 절반을 thought 에 할당 (안전 디폴트).
      thinkingConfig: {
        thinkingBudget: thinkingBudget ?? Math.max(512, Math.floor(maxOutputTokens / 2)),
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
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function runGenericWorkersAI(
  env: Env,
  model: string,
  systemPrompt: string,
  userText: string,
  maxOutputTokens: number,
): Promise<string> {
  const raw = await env.AI.run(model as Parameters<Ai["run"]>[0], {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    max_tokens: maxOutputTokens,
    temperature: 0.1,
  });
  return extractText(raw);
}

/* ── JSON 파서 ─────────────────────────────────────────────────────────── */

function extractJsonObject(raw: string): unknown | null {
  if (!raw) return null;
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    return null;
  }
}

function parseBriefing(raw: string): BriefingCard[] | null {
  const obj = extractJsonObject(raw) as { cards?: unknown } | null;
  if (!obj || !Array.isArray(obj.cards)) return null;
  const cards: BriefingCard[] = [];
  for (const c of obj.cards) {
    if (typeof c !== "object" || c === null) continue;
    const title = typeof (c as BriefingCard).title === "string" ? (c as BriefingCard).title.trim() : "";
    const body = typeof (c as BriefingCard).body === "string" ? (c as BriefingCard).body.trim() : "";
    if (!title || !body) continue;
    cards.push({ title, body });
    if (cards.length === 3) break;
  }
  return cards.length > 0 ? cards : null;
}

function parseOneline(raw: string): string | null {
  const obj = extractJsonObject(raw) as { oneLine?: unknown } | null;
  if (!obj || typeof obj.oneLine !== "string") return null;
  const trimmed = obj.oneLine.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCharacter(raw: string): Record<CharacterSignalKey, CharacterLevel> | null {
  const obj = extractJsonObject(raw) as { signals?: Record<string, unknown> } | null;
  if (!obj || typeof obj.signals !== "object" || obj.signals === null) return null;
  const signals = obj.signals;
  const out = {} as Record<CharacterSignalKey, CharacterLevel>;
  for (const key of CHARACTER_SIGNAL_ORDER) {
    const v = signals[key];
    const num = typeof v === "number" ? v : Number(v);
    if (num !== 1 && num !== 2 && num !== 3) return null;
    out[key] = num as CharacterLevel;
  }
  return out;
}

function parseRewrite(raw: string): string | null {
  const obj = extractJsonObject(raw) as { rewritten?: unknown } | null;
  if (!obj || typeof obj.rewritten !== "string") return null;
  const trimmed = obj.rewritten.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default app;
