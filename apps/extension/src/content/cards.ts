/**
 * specs/01 — 본문 root 위쪽에 3장 카드 (briefing), 아래쪽에 한 줄 정리 (oneline).
 *
 * 7개 병렬 아키텍처: briefing 과 oneline 은 *각자 별도 AI 호출* — 도착하는 대로 렌더.
 * 한 쪽이 늦거나 실패해도 다른 쪽은 즉시 노출된다.
 *
 * 위치: root 의 *바깥 형제*로 삽입 (insertAdjacentElement) — 본문 레이아웃을 깨지 않고
 *       위/아래에 자연스럽게 붙는다.
 */
import type { BriefingResponse, OneLineResponse } from "@newtrospect/core/server";

const CARDS_ID = "nts-cards";
const ONELINE_ID = "nts-oneline";
const STYLE_ID = "nts-summary-styles";

export function renderCards(root: Element, briefing: BriefingResponse): void {
  ensureStyles();
  document.getElementById(CARDS_ID)?.remove();

  const top = document.createElement("section");
  top.id = CARDS_ID;
  top.innerHTML = `
    <div class="nts-cards-head">
      <span class="nts-cards-eyebrow">읽기 전 맥락</span>
      <span class="nts-cards-hint">기사 이해를 돕는 배경 3가지</span>
    </div>
    <div class="nts-cards-grid">
      ${briefing.cards.map(renderCard).join("")}
    </div>
  `;
  root.insertAdjacentElement("beforebegin", top);
}

export function renderOneline(root: Element, ol: OneLineResponse): void {
  ensureStyles();
  document.getElementById(ONELINE_ID)?.remove();

  const bottom = document.createElement("section");
  bottom.id = ONELINE_ID;
  bottom.innerHTML = `
    <span class="nts-oneline-label">이 기사 한 줄</span>
    <p class="nts-oneline-body">${escapeHtml(ol.oneLine)}</p>
  `;
  root.insertAdjacentElement("afterend", bottom);
}

export function removeCardsAndOneline(): void {
  document.getElementById(CARDS_ID)?.remove();
  document.getElementById(ONELINE_ID)?.remove();
}

function renderCard(c: { title: string; body: string }, i: number): string {
  return `
    <article class="nts-card">
      <span class="nts-card-num">${i + 1}</span>
      <h3 class="nts-card-title">${escapeHtml(c.title)}</h3>
      <p class="nts-card-body">${escapeHtml(c.body)}</p>
    </article>
  `;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${CARDS_ID} {
      box-sizing: border-box;
      margin: 16px 0 20px;
      padding: 14px 16px 16px;
      background: linear-gradient(180deg, rgba(245,247,252,0.92) 0%, rgba(238,242,250,0.92) 100%);
      border: 1px solid rgba(80, 110, 200, 0.18);
      border-radius: 10px;
      font: 13px/1.5 system-ui, -apple-system, "Pretendard", "Apple SD Gothic Neo", sans-serif;
      color: #1c2230;
    }
    #${CARDS_ID} .nts-cards-head {
      display: flex; align-items: baseline; gap: 10px;
      margin-bottom: 10px;
    }
    #${CARDS_ID} .nts-cards-eyebrow {
      font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
      color: #4a5b8a; font-weight: 700;
    }
    #${CARDS_ID} .nts-cards-hint {
      font-size: 12px; color: #6a7290;
    }
    #${CARDS_ID} .nts-cards-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    @media (max-width: 720px) {
      #${CARDS_ID} .nts-cards-grid { grid-template-columns: 1fr; }
    }
    #${CARDS_ID} .nts-card {
      position: relative;
      background: #fff;
      border: 1px solid rgba(60, 80, 140, 0.12);
      border-radius: 8px;
      padding: 12px 12px 12px 14px;
      box-shadow: 0 1px 2px rgba(20, 30, 60, 0.04);
    }
    #${CARDS_ID} .nts-card-num {
      position: absolute; top: 10px; right: 12px;
      font-size: 11px; font-weight: 700; color: #b8c1d8;
    }
    #${CARDS_ID} .nts-card-title {
      margin: 0 22px 6px 0;
      font-size: 13px; font-weight: 700; color: #1c2538; line-height: 1.4;
    }
    #${CARDS_ID} .nts-card-body {
      margin: 0;
      font-size: 12.5px; color: #3b4258; line-height: 1.55;
      word-break: keep-all;
    }
    #${ONELINE_ID} {
      box-sizing: border-box;
      margin: 24px 0 8px;
      padding: 14px 18px;
      background: rgba(255, 244, 220, 0.78);
      border-left: 4px solid #f0b400;
      border-radius: 4px;
      font: 14px/1.55 system-ui, -apple-system, "Pretendard", "Apple SD Gothic Neo", sans-serif;
      color: #2a2418;
      display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    }
    #${ONELINE_ID} .nts-oneline-label {
      flex: 0 0 auto;
      font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
      color: #8a6d10; font-weight: 700;
    }
    #${ONELINE_ID} .nts-oneline-body {
      flex: 1 1 auto;
      margin: 0;
      font-size: 14.5px; font-weight: 500; color: #2a2418; word-break: keep-all;
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}
