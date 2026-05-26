/**
 * span.start / span.end 는 유니코드 *코드포인트* 오프셋이다.
 * UTF-16 code unit 이 아니라는 점에 주의 — 이모지·서로게이트 페어가
 * 한국 뉴스 본문에 거의 없긴 하지만, 서버·클라이언트가 동일한 단위를
 * 쓰지 않으면 좌표가 어긋난다. 본문 처리 시 항상 Array.from(text)
 * 또는 [...text] 로 코드포인트 단위로 분해해 인덱싱한다.
 */

export type AnalysisKind = "term" | "sensational" | "quantitative" | "context";

export interface SpanBase {
  start: number;
  end: number;
  kind: AnalysisKind;
}

export interface TermSpan extends SpanBase {
  kind: "term";
  payload: { explanation: string };
}

export interface SensationalSpan extends SpanBase {
  kind: "sensational";
  payload: { reason: string };
}

export interface QuantitativeSpan extends SpanBase {
  kind: "quantitative";
  payload: { searchQuery: string };
}

export interface ContextSpan extends SpanBase {
  kind: "context";
  payload: Record<string, never>;
}

export type Span = TermSpan | SensationalSpan | QuantitativeSpan | ContextSpan;

export interface AnalyzeRequest {
  text: string;
  lang: "ko";
}

export interface AnalyzeResponse<S extends Span = Span> {
  spans: S[];
  model: string;
  elapsedMs: number;
  cached?: boolean;
}

export interface DetectArticleRequest {
  text: string;
  url?: string;
}

export interface DetectArticleResponse {
  isArticle: boolean;
  cleanedText: string;
  reason?: string;
}

/** 200자 미만은 단신·페이월·로그인 벽으로 간주 → 분석 안 함. */
export const MIN_BODY_LENGTH = 200;

export const ANALYZE_ENDPOINTS = {
  term: "/api/analyze/terms",
  sensational: "/api/analyze/sensational",
  quantitative: "/api/analyze/quantitative",
  context: "/api/analyze/context",
} as const satisfies Record<AnalysisKind, string>;

/* ── 한줄정리·카드뉴스 (specs/01) ─────────────────────────────────────────── */
/*
 * 7개 병렬 아키텍처: 카드 3장과 한 줄 정리는 *각자 별도 AI 호출*.
 * 모델 차등 — 카드는 외부 지식·추론 필요(Pro), 한 줄은 본문 압축(flash) 충분.
 */

/** 본문 위쪽에 표시되는 *읽기 전 맥락 카드* 1장. 외부 배경지식 기반. */
export interface BriefingCard {
  title: string;
  body: string;
}

export interface BriefingRequest {
  text: string;
  lang: "ko";
}

export interface BriefingResponse {
  /** 정확히 3장. 본문 이해를 돕는 배경 맥락 (인물·기관·사건 배경·관련 통계 등). */
  cards: BriefingCard[];
  model: string;
  elapsedMs: number;
  cached?: boolean;
}

export const BRIEFING_ENDPOINT = "/api/analyze/briefing";

export interface OneLineRequest {
  text: string;
  lang: "ko";
}

export interface OneLineResponse {
  /** 본문 한 줄 요약. 마침표 포함 1문장. */
  oneLine: string;
  model: string;
  elapsedMs: number;
  cached?: boolean;
}

export const ONELINE_ENDPOINT = "/api/analyze/oneline";

/* ── 자극적 표현 → 온화한 표현 변환 (specs/03) ───────────────────────────── */

export interface RewriteSensationalRequest {
  /** 원문 본문에서 자극적이라고 표시된 *문장 1개*. */
  text: string;
  /** 옵션 — popover 에 표시했던 reason (모델에게 추가 단서로 전달). */
  reason?: string;
}

export interface RewriteSensationalResponse {
  /** 자극 어휘를 중립적·사실 중심으로 다시 쓴 문장. */
  rewritten: string;
  model: string;
  elapsedMs: number;
  cached?: boolean;
}

export const REWRITE_SENSATIONAL_ENDPOINT = "/api/rewrite/sensational";

/* ── 글 성격 분석 (specs/04) ─────────────────────────────────────────────── */

export type CharacterSignalKey =
  | "fact_claim"      // 사실주장
  | "opinion"         // 의견/해석
  | "value_judgment"  // 가치판단
  | "sensational"     // 자극표현
  | "evidence"        // 근거제시
  | "causation"       // 인과주장
  | "prediction";     // 예측

/** 1=적음, 2=일부 있음, 3=두드러짐. */
export type CharacterLevel = 1 | 2 | 3;

export const CHARACTER_SIGNAL_LABELS: Record<CharacterSignalKey, string> = {
  fact_claim: "사실주장",
  opinion: "의견/해석",
  value_judgment: "가치판단",
  sensational: "자극표현",
  evidence: "근거제시",
  causation: "인과주장",
  prediction: "예측",
};

export const CHARACTER_SIGNAL_ORDER: readonly CharacterSignalKey[] = [
  "fact_claim",
  "opinion",
  "value_judgment",
  "sensational",
  "evidence",
  "causation",
  "prediction",
];

export interface CharacterRequest {
  text: string;
  lang: "ko";
}

export interface CharacterResponse {
  signals: Record<CharacterSignalKey, CharacterLevel>;
  model: string;
  elapsedMs: number;
  cached?: boolean;
}

export const CHARACTER_ENDPOINT = "/api/analyze/character";
