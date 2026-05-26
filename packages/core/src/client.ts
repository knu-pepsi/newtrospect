import type {
  AnalysisKind,
  AnalyzeResponse,
  BriefingResponse,
  CharacterResponse,
  DetectArticleResponse,
  OneLineResponse,
  RewriteSensationalResponse,
  Span,
} from "./types.ts";
import {
  ANALYZE_ENDPOINTS,
  BRIEFING_ENDPOINT,
  CHARACTER_ENDPOINT,
  ONELINE_ENDPOINT,
  REWRITE_SENSATIONAL_ENDPOINT,
} from "./types.ts";

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export class NewtrospectClient {
  constructor(private readonly opts: ClientOptions) {}

  async detectArticle(text: string, url?: string): Promise<DetectArticleResponse> {
    return this.post<DetectArticleResponse>("/api/detect-article", { text, url });
  }

  async analyze(
    kind: AnalysisKind,
    text: string,
  ): Promise<AnalyzeResponse> {
    return this.post<AnalyzeResponse>(ANALYZE_ENDPOINTS[kind], { text, lang: "ko" });
  }

  /**
   * 4개 분석을 병렬 호출. allSettled 라 일부 실패해도 나머지는 렌더된다.
   * 호출 측은 status === "fulfilled" 인 결과만 렌더하면 된다.
   */
  async analyzeAll(text: string): Promise<Record<AnalysisKind, PromiseSettledResult<AnalyzeResponse<Span>>>> {
    const kinds: AnalysisKind[] = ["term", "sensational", "quantitative", "context"];
    const results = await Promise.allSettled(kinds.map((k) => this.analyze(k, text)));
    const map = {} as Record<AnalysisKind, PromiseSettledResult<AnalyzeResponse<Span>>>;
    kinds.forEach((k, i) => {
      map[k] = results[i]!;
    });
    return map;
  }

  /** 본문 상단 3장 맥락 카드 (specs/01). */
  async briefing(text: string): Promise<BriefingResponse> {
    return this.post<BriefingResponse>(BRIEFING_ENDPOINT, { text, lang: "ko" });
  }

  /** 본문 하단 한 줄 요약 (specs/01). */
  async oneline(text: string): Promise<OneLineResponse> {
    return this.post<OneLineResponse>(ONELINE_ENDPOINT, { text, lang: "ko" });
  }

  /** 글 성격 7신호 (specs/04). */
  async character(text: string): Promise<CharacterResponse> {
    return this.post<CharacterResponse>(CHARACTER_ENDPOINT, { text, lang: "ko" });
  }

  /** 자극적 문장을 온화한 표현으로 변환 (specs/03). */
  async rewriteSensational(text: string, reason?: string): Promise<RewriteSensationalResponse> {
    return this.post<RewriteSensationalResponse>(REWRITE_SENSATIONAL_ENDPOINT, { text, reason });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(`${this.opts.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: this.opts.signal,
    });
    if (!res.ok) {
      throw new Error(`${path} ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
