/**
 * specs/04 — 우측 fixed 패널에 글 성격 7신호를 1~3 단계 막대로 표시.
 *
 * 좁은 화면(720px 이하)에서는 본문을 가리지 않게 자동 숨김 (CSS @media).
 * 사용자가 닫으면 그 페이지에 한해 다시 안 띄움 (재호출 시 무시).
 */
import {
  CHARACTER_SIGNAL_LABELS,
  CHARACTER_SIGNAL_ORDER,
  type CharacterResponse,
  type CharacterSignalKey,
} from "@newtrospect/core/server";

const PANEL_ID = "nts-character";
const STYLE_ID = "nts-character-styles";

let dismissed = false;

export function renderCharacter(c: CharacterResponse): void {
  if (dismissed) return;
  ensureStyles();
  const el = ensurePanel();
  el.innerHTML = `
    <header class="nts-char-head">
      <span class="nts-char-eyebrow">글 성격</span>
      <button class="nts-char-close" type="button" aria-label="닫기">×</button>
    </header>
    <ul class="nts-char-list">
      ${CHARACTER_SIGNAL_ORDER.map((k) => renderRow(k, c.signals[k])).join("")}
    </ul>
    <p class="nts-char-foot">1=적음 · 2=일부 · 3=두드러짐</p>
  `;
  el.style.display = "block";
  el.querySelector(".nts-char-close")?.addEventListener("click", () => {
    dismissed = true;
    hideCharacter();
  });
}

export function hideCharacter(): void {
  const el = document.getElementById(PANEL_ID);
  if (el) el.style.display = "none";
}

/** SPA 페이지 전환 시 호출 — 새 페이지에서 다시 띄울 수 있게 dismissed 초기화. */
export function resetCharacterDismiss(): void {
  dismissed = false;
  hideCharacter();
}

function renderRow(k: CharacterSignalKey, lv: 1 | 2 | 3): string {
  return `
    <li class="nts-char-row" data-lv="${lv}">
      <span class="nts-char-label">${CHARACTER_SIGNAL_LABELS[k]}</span>
      <span class="nts-char-bars" aria-label="${lv}/3">
        <span class="nts-char-bar ${lv >= 1 ? "on" : ""}"></span>
        <span class="nts-char-bar ${lv >= 2 ? "on" : ""}"></span>
        <span class="nts-char-bar ${lv >= 3 ? "on" : ""}"></span>
      </span>
    </li>
  `;
}

function ensurePanel(): HTMLElement {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;
  const el = document.createElement("aside");
  el.id = PANEL_ID;
  document.body.appendChild(el);
  return el;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      top: 80px;
      right: 16px;
      z-index: 2147483645;
      width: 200px;
      padding: 12px 14px 10px;
      background: rgba(28, 30, 38, 0.94);
      color: #f1f3f8;
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
      font: 12px/1.4 system-ui, -apple-system, "Pretendard", "Apple SD Gothic Neo", sans-serif;
      display: none;
    }
    @media (max-width: 1100px) {
      /* 본문 폭이 좁아 패널이 본문을 가리는 경우 자동 숨김. */
      #${PANEL_ID} { display: none !important; }
    }
    #${PANEL_ID} .nts-char-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px;
    }
    #${PANEL_ID} .nts-char-eyebrow {
      font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
      color: #b8c1da; font-weight: 700;
    }
    #${PANEL_ID} .nts-char-close {
      background: transparent; border: 0; color: #b8c1da;
      font-size: 16px; line-height: 1; cursor: pointer;
      padding: 2px 4px; border-radius: 4px;
    }
    #${PANEL_ID} .nts-char-close:hover { background: rgba(255,255,255,0.1); color:#fff; }
    #${PANEL_ID} .nts-char-list {
      list-style: none; padding: 0; margin: 0;
    }
    #${PANEL_ID} .nts-char-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    #${PANEL_ID} .nts-char-row:last-child { border-bottom: 0; }
    #${PANEL_ID} .nts-char-label { font-size: 12.5px; color: #e6e9f2; }
    #${PANEL_ID} .nts-char-bars { display: flex; gap: 3px; }
    #${PANEL_ID} .nts-char-bar {
      width: 14px; height: 8px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
    }
    #${PANEL_ID} .nts-char-row[data-lv="1"] .nts-char-bar.on { background: #7bd389; }
    #${PANEL_ID} .nts-char-row[data-lv="2"] .nts-char-bar.on { background: #f6c14a; }
    #${PANEL_ID} .nts-char-row[data-lv="3"] .nts-char-bar.on { background: #ff7a7a; }
    #${PANEL_ID} .nts-char-foot {
      margin: 8px 0 0;
      font-size: 10.5px; color: #8a93ac; text-align: right;
    }
  `;
  document.head.appendChild(style);
}
