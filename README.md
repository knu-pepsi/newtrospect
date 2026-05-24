# newtrospect

AI 기반 비판적 뉴스 읽기 보조 도구. 한국 뉴스 사이트의 본문을 자동 감지해 4가지 분석을 인라인 하이라이트로 보여줍니다.

- 🔵 **파랑** — 어려운 용어 + 문맥 기반 설명 (툴팁)
- 🔴 **빨강** — 자극적/선동적 표현 (이유 툴팁)
- 🟢 **초록** — 수치/정량 표현 (Google 검색용 쿼리 툴팁)
- 🟡 **노랑** — 핵심 문맥 문장 (시각 표시)

## 설치
- 안드로이드 [다운로드](https://expo.dev/accounts/ballbot3/projects/newtrospect/builds/05a4ae40-3a12-4d6b-a4d4-de8e5243073e)
- 브라우저 익스텐션 [다운로드](https://github.com/knu-pepsi/newtrospect/releases/tag/extension)

## 구조

```
apps/
  extension/   Manifest V3 브라우저 익스텐션 (Chrome/Firefox)
  mobile/      Expo Go + react-native-webview 안드로이드 앱 (S1 spike 단계)
  worker/      Cloudflare Workers + Workers AI + D1
packages/
  core/        @newtrospect/core — 본문 추출 · API 클라이언트 · 타입 공용
```

좌표계는 **유니코드 코드포인트** (UTF-16 코드 유닛 아님). LLM 에는 인덱스를 출력시키지 않고 원문 부분 문자열만 출력하게 한 뒤 서버에서 매칭 (`apps/worker/src/match-spans.ts`).

## 현재 상태 (2026-05-21)

- 4개 패키지 스캐폴딩 + S2 spike 완료 — Workers AI 모델 `@cf/meta/llama-3.1-8b-instruct` 채택
- 남은 spike: S1 (Expo Go WebView), 셀렉터 실측
- 본 구현은 spike 통과 후 진행
- 자세한 진행상황과 다음 액션은 [`STATUS.md`](./STATUS.md), 설계는 별도 디자인 문서(`~/.gstack/projects/newtrospect/ballbot-main-design-20260519-185536.md`)

## 요구사항

- Node.js ≥ 20
- pnpm ≥ 10
- Cloudflare 계정 + Workers AI / D1 활성화 (워커 띄울 때만)
- Expo Go 설치된 안드로이드 폰 (모바일 spike/구현용)

## 설치

```bash
pnpm install
```

## 자주 쓰는 명령

```bash
# 전체 typecheck
pnpm typecheck

# 전체 단위 테스트
pnpm test

# 워커 로컬 실행 (포트 8787, Workers AI는 원격)
pnpm --filter @newtrospect/worker dev

# 워커 헬스
curl http://localhost:8787/health

# 익스텐션 빌드 → apps/extension/dist 를 chrome://extensions 에서 "압축 해제 로드"
pnpm --filter @newtrospect/extension build

# 익스텐션 dev (HMR)
pnpm --filter @newtrospect/extension dev

# 모바일 spike 앱 (Expo Go)
pnpm --filter @newtrospect/mobile start

# S2 spike 재측정 (워커 띄운 상태에서)
pnpm --filter @newtrospect/worker spike:s2

# D1 캐시 비우기 (모델 갈아끼우며 spike 비교할 때)
cd apps/worker && npx wrangler d1 execute newtrospect --local --command="DELETE FROM analysis_cache"
```

## 익스텐션 사용

1. `pnpm --filter @newtrospect/worker dev` 로 워커 8787 띄움
2. `pnpm --filter @newtrospect/extension build` 후 `chrome://extensions` → 개발자 모드 → "압축 해제된 확장 프로그램 로드" → `apps/extension/dist`
3. 한국 뉴스 사이트 접속 → 자동 감지 또는 툴바 아이콘 클릭
4. 우상단 진행 뱃지로 분석 상태 확인 (분석 중 / 완료 / 오류 / 기사 아님)
5. 옵션 페이지에서 API URL · 자동 감지 · 4색 토글 설정

## 핵심 설계 결정

- **본문 추출은 클라이언트에서만** — 서버 fetch 안 함 (봇 차단·로그인 벽 회피)
- **캐시 키 = 본문 SHA-256** — URL 아님. 같은 기사 다른 URL 변종에도 캐시 hit
- **D1 누적 저장은 Phase 1=캐시만 / Phase 2=매일 사용 검증 후**
- **provider abstraction** — 인터페이스만 + `WorkersAIProvider` 1개로 시작. Gemini 등 다른 provider 추가 시 `apps/worker/src/providers/` 에 신설
- **모델 응답 schema 모델별로 다름** — `workers-ai.ts:extractText()` 가 흡수 (string / {response:string} / {response:{items:[...]}} / OpenAI choices 호환)

## 라이선스

(미정)
