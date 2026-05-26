import type { AnalysisKind, Span } from "@newtrospect/core/server";

/**
 * DOM 하이라이트 적용.
 *
 * 좌표계: span.start/end 는 root.textContent 의 *코드포인트* 오프셋.
 * root.textContent 와 본문 텍스트 추출에 사용된 텍스트가 동일해야 좌표가 맞는다.
 *
 * 알고리즘: TreeWalker 로 Text 노드를 순회하면서 누적 코드포인트 오프셋을 추적,
 * span 경계에 도달하면 Range 로 wrap.
 *
 * 두-패스 레이어링:
 *   1. context (노란색) 먼저 wrap — 문장 단위 배경.
 *   2. 그 위에 sensational/quantitative/term inline wrap.
 *   이렇게 해야 노란 형광펜 위에 다른 강조가 *덮이지 않고 공존* 한다.
 *   ※ context wrap 이후엔 text node 가 split 되니, 2 패스에서 pieces 를 재수집.
 *
 * 데이터 보존: 각 nts-mark 에 data-payload(JSON 직렬화된 Span[]) 를 부착해
 *   popover 가 클릭 시 그 자리에서 종류별 표시를 만들 수 있게 한다.
 */

/**
 * 우선순위: 노랑(context) < 빨강(sensational) < (파랑 term, 초록 quantitative)
 * - 파랑/초록 동시 후보면 파랑(term) 우선
 * - 한 위치에 여러 종류가 겹치면 시각·툴팁 모두 우선순위 최고 1개만 노출
 * (사양: specs/02-하이라이트고도화.md)
 */
const INLINE_PRIORITY: Record<Exclude<AnalysisKind, "context">, number> = {
  term: 0,
  quantitative: 1,
  sensational: 2,
};

export const HIGHLIGHT_CLASS: Record<AnalysisKind, string> = {
  term: "nts-term",
  sensational: "nts-sensational",
  quantitative: "nts-quantitative",
  context: "nts-context",
};

interface MergedMark {
  start: number;
  end: number;
  primary: AnalysisKind;
  all: Span[];
}

/**
 * 파랑(term)·초록(quantitative) 영역이 겹치면 초록 쪽을 제거.
 * 같은 위치에 두 색이 동시에 그려지면 사용자가 어느 popover 가 뜰지 헷갈리는 버그 방지.
 */
function suppressTermQuantitativeOverlap(spans: Span[]): Span[] {
  const terms = spans.filter((s) => s.kind === "term");
  if (terms.length === 0) return spans;
  return spans.filter((s) => {
    if (s.kind !== "quantitative") return true;
    for (const t of terms) {
      if (s.start < t.end && s.end > t.start) return false;
    }
    return true;
  });
}

function mergeInlineOverlaps(spans: Span[]): MergedMark[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MergedMark[] = [];

  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.all.push(s);
      if (s.kind !== "context" && last.primary !== "context") {
        const sp = INLINE_PRIORITY[s.kind as Exclude<AnalysisKind, "context">];
        const lp = INLINE_PRIORITY[last.primary as Exclude<AnalysisKind, "context">];
        if (sp < lp) last.primary = s.kind;
      }
    } else {
      out.push({ start: s.start, end: s.end, primary: s.kind, all: [s] });
    }
  }
  return out;
}

interface TextPiece {
  node: Text;
  start: number;
  end: number;
}

function collectTextPieces(root: Element): { pieces: TextPiece[]; total: number } {
  const pieces: TextPiece[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue && n.nodeValue.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? "";
    const cpLen = Array.from(text).length;
    pieces.push({ node: node as Text, start: offset, end: offset + cpLen });
    offset += cpLen;
    node = walker.nextNode();
  }
  return { pieces, total: offset };
}

function cpRangeToUtf16(text: string, cpStart: number, cpEnd: number): { start: number; end: number } {
  let utf16Start = 0;
  let utf16End = 0;
  let cp = 0;
  for (let i = 0; i < text.length; ) {
    if (cp === cpStart) utf16Start = i;
    if (cp === cpEnd) {
      utf16End = i;
      return { start: utf16Start, end: utf16End };
    }
    const code = text.codePointAt(i)!;
    i += code > 0xffff ? 2 : 1;
    cp++;
  }
  if (cp === cpEnd) utf16End = text.length;
  if (cp === cpStart) utf16Start = text.length;
  return { start: utf16Start, end: utf16End };
}

export function applyHighlights(root: Element, spans: Span[]): void {
  const contextSpans = spans.filter((s): s is Extract<Span, { kind: "context" }> => s.kind === "context");
  const inlineSpans = suppressTermQuantitativeOverlap(spans.filter((s) => s.kind !== "context"));

  // Pass 1: context 노란 배경 먼저 (서로 겹치면 합치되, 색은 노랑 유지)
  if (contextSpans.length > 0) {
    const merged = mergeInlineOverlaps(contextSpans);
    const { pieces } = collectTextPieces(root);
    for (const mark of merged.slice().reverse()) applyMark(pieces, mark);
  }

  // Pass 2: 다른 색 inline 강조. context wrap 이후라 pieces 재수집.
  if (inlineSpans.length > 0) {
    const merged = mergeInlineOverlaps(inlineSpans);
    const { pieces } = collectTextPieces(root);
    for (const mark of merged.slice().reverse()) applyMark(pieces, mark);
  }
}

function applyMark(pieces: TextPiece[], mark: MergedMark): void {
  const overlapping = pieces.filter((p) => p.start < mark.end && p.end > mark.start);
  if (overlapping.length === 0) return;

  for (const piece of overlapping) {
    const localCpStart = Math.max(0, mark.start - piece.start);
    const localCpEnd = Math.min(piece.end - piece.start, mark.end - piece.start);
    if (localCpEnd <= localCpStart) continue;

    const text = piece.node.nodeValue ?? "";
    const { start, end } = cpRangeToUtf16(text, localCpStart, localCpEnd);
    if (end <= start) continue;

    const range = document.createRange();
    try {
      range.setStart(piece.node, start);
      range.setEnd(piece.node, end);
    } catch {
      continue;
    }
    const wrap = document.createElement("nts-mark");
    wrap.className = HIGHLIGHT_CLASS[mark.primary];
    wrap.dataset.kinds = Array.from(new Set(mark.all.map((s) => s.kind))).join(",");
    wrap.dataset.payload = JSON.stringify(mark.all);
    try {
      range.surroundContents(wrap);
    } catch {
      // partial coverage (Range crosses element boundary) — 본 cut 에선 스킵
    }
  }
}
