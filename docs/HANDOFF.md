# HANDOFF

> 마지막 갱신: **2026-09-20** · 상태: **외부 자격증명 대기로 일시 중단**

다음 세션에서 이 파일부터 읽으면 컨텍스트 없이 바로 이어갈 수 있습니다.

---

## 1. 프로젝트 목적과 제품 철학

**먹은 것을 평소 말하듯 입력하면 기록하고, 오늘 얼마나 더 먹을 수 있는지 바로 보여준다.**

```
나: 갈비탕 하나랑 밥 한 공기 먹었어
앱: 기록했어요. 오늘 1,580 / 2,100 kcal · 520 kcal 남았어요.
```

MyFitnessPal의 반대를 지향합니다. 화면은 **오늘 상태 · 오늘 먹은 것 · 대화 입력창** 셋뿐이고, 커뮤니티·배지·스트릭·체중 그래프·운동 프로그램은 없습니다. CRUD 버튼을 전면에 노출하지 않습니다 — 수정도 말로 합니다.

### 이 프로젝트를 지탱하는 규칙

```
Jev              판단한다   — intent, 확신도, 어떤 기록을 가리키는가
NutritionResolver 조회한다   — 음식명/양 → 영양정보
TypeScript        계산하고 바꾼다 — 합산, 잔량, 상태 변경
```

**AI가 이해하고 판단한다. 코드가 계산하고 변경한다.** 이 앱은 "AI로 칼로리 계산기 만들었다"가 아니라 **역할을 쪼갠 Jev 실전 예제**로서의 가치가 큽니다 (사용자가 전자책 사례로 쓸 예정).

말투는 극도로 짧게. 과한 격려·훈계·건강 코칭 없음. 의학적 진단/치료 목적 아님.

---

## 2. 완료된 Phase와 커밋

| Phase | 내용 | 커밋 |
| --- | --- | --- |
| 0 | 조사 — Jev 문서, 스택 버전, 한국 영양 데이터 후보 | (문서만) |
| 1 | 프로젝트 기반, env 스키마, 한국어 골든셋 60건 | `8963eac` |
| 2 | UI shell (mock data) | `631871f` |
| 3 | 도메인 + localStorage persistence | `5643701` |
| 4 | Jev 판단 파이프라인 | `0bb84b7` |
| **5A** | **deterministic nutrition pipeline** | **이번 커밋** |
| 4.5 | Jev 한국어 실측 | ⛔ **차단** |
| 5B | 식약처 데이터 투입 + LLM fallback | ⛔ **차단** |
| 6 | 자연어 end-to-end | 미착수 |

---

## 3. 현재 아키텍처

### 상태 경계 (Phase 1에서 확정, 이후 전부 유지)

```
┌─ Browser ─ 상태의 유일한 소유자 ────────────────────────┐
│  localStorage ←→ Repository ←→ React state              │
└───────────────┬──────────────────────────────────────────┘
                │ POST /api/chat { message, now,
                │                  dailyGoalCalories, recentItems }
                ▼
┌─ Server ─ stateless, secret 보유 ───────────────────────┐
│  Jev judgment → confidence policy → Command             │
│  저장소 접근 없음. 아무것도 변경하지 않음.                 │
└───────────────┬──────────────────────────────────────────┘
                │ { command, judgment }
                ▼
      Browser가 command를 적용 → 재계산 → 렌더
```

규칙 6개는 [`architecture.md`](architecture.md) §2 참조. 핵심: **서버는 Command만 반환하고 실제 변경은 브라우저가 한다**, **합산은 클라이언트가 한다**, **확인은 서버 재호출 없이 클라이언트에서 처리한다**.

### 폴더

```
src/
  app/                  page.tsx(서버 셸) · api/chat/{route,schema}.ts
  domain/               meal · calories · date · limits · repository   (의존성 0)
  application/          mealRecords · dailyGoal · commands
  infrastructure/       storage · schemas · localStorage{MealRecord,DailyGoal}Repository
  ai/
    judgment/           types · questions · jevJudge · mockJudge · confidence · goldenSet
    nutrition/          quantity · foodPhrases · dataset · localDatasetResolver · types
  components/           TodayScreen(유일한 "use client") · TodaySummary · MealList
                        · ChatInput · GoalEditor · replyText
fixtures/               korean-inputs.json (골든셋 60건)
scripts/                evalJev.eval.ts
```

### 확정된 기술 선택

Next.js 16.3.5 · React 19.3.0 · **TypeScript 5.9.3** (7.x 아님) · Tailwind 4.3.3 · **ESLint 9.39.5** (10 아님 — `eslint-config-next`의 번들 플러그인이 9까지만 지원) · zod 4.6.5 · vitest 5.0.1 · **pnpm 12.5.1**

> pnpm은 corepack 0.36을 `~/.local`에 설치해 쓰고 있습니다. 시스템 corepack 0.33은 pnpm 11+ bin 경로를 몰라 실패합니다.

### 도메인에서 되돌리면 안 되는 결정

- `MealRecord.totalCalories`를 **저장하지 않음** — 항상 items에서 파생 (수정 시 드리프트 방지)
- date key는 **로컬 달력 기준**. `toISOString().slice(0,10)` 금지 (서울 오전 9시 이전이 전날로 밀림)
- `DailyGoal`은 **carry-forward** (그날 값 없으면 이전 최신). `getExact()`는 별도 유지
- localStorage 부분 손상 시 **유효 레코드만 복구**
- 골든셋의 `"커피는 안 마셨음"`은 **delete 의미** (0 kcal 레코드를 남기지 않기 위해)

---

## 4. Jev / TypeSafe 현재 상태

| 항목 | 상태 |
| --- | --- |
| SDK | `@typesafe-ai/sdk` **0.6.0** 설치·연동 완료 |
| 모델 | SDK 기본 `jev-latest` → `jev-1.13.0` |
| 질문 정의 | 완료 (`questions.ts`) |
| Command 매핑 | 완료 (`application/commands.ts`) |
| 확신도 정책 | 구현 완료, **값은 미확정** |
| mock fallback | 완료 — 키 없이 앱 전체 정상 동작 |
| **실제 Jev 호출** | **0회** |

### 질문 4개 (한 요청에 fan-out)

| 질문 | 타입 | 응답 |
| --- | --- | --- |
| `intent` | choice (add/modify/delete/ask_status/ask_recommendation/**other**) | `choice` + **`confidence`** |
| `actual_consumption` | noul | **`noul` 확률만 — confidence 없음** |
| `clarification` | noul | 동일 |
| `reference` | choice (동적 후보 + `none` 탈출) | `choice` + `confidence` |

**`instructions`/`criteria`는 영어, `state`의 사용자 발화는 한국어 원문 그대로.** 모델 카드가 CJK 정확도 하락을 명시하고 있고, 번역하면 수정 판단에 필요한 어휘가 사라지기 때문입니다.

**reference 후보는 `entry_1..entry_n` 라벨**로 주고 코드가 실제 id로 되돌립니다. 모델이 주지 않은 라벨을 반환하면 버립니다 (테스트로 고정).

### 타입에서 강제하는 것

```ts
type Judgment = {
  intent: Intent;
  intentConfidence: number;              // choice의 confidence
  actualConsumptionProbability: number;  // noul — confidence 아님
  clarificationProbability: number;      // noul — confidence 아님
  referenceTargetId: string | null;
  referenceConfidence: number | null;
  source: "jev" | "mock";
};
```

noul 값에 confidence라는 이름을 **쓰지 않습니다.** 이름이 다르면 같은 threshold helper에 넣을 수 없습니다. `classifyConfidence()`(choice 3분기)와 `isProbable()`(noul 단순 임계값)도 분리되어 있습니다. **이 구분을 되돌리지 마세요.**

---

## 5. Phase 4.5가 막힌 정확한 이유

> **Jev integration implemented, real Korean accuracy not yet validated.**

**`TYPESAFE_API_KEY`가 없습니다. 그리고 이 키는 즉시 발급이 아니라 waitlist 승인을 받아야 합니다.** 신청해도 바로 나오지 않으므로 대기 기간이 길 수 있습니다.

그 결과:

- Jev를 **한 번도 호출하지 못했습니다** (`pnpm eval:jev`는 안내 후 skip)
- 실제 한국어 intent / consumption / clarification / reference 정확도가 **전부 미측정**
- 확신도 임계값이 **문서 기반 baseline에 머물러 있음**
- reference 전략 A/B/C를 **고르지 못함**

### ⚠️ mock 점수를 Jev 근거로 읽지 마세요

`EVAL_JUDGE=mock pnpm eval:jev` 결과는 intent 100% / consumption 100% / clarification 96.7% / reference 90%입니다. **이 규칙들은 바로 그 60건을 보고 작성했습니다.** 일반화 성능이 아니라 "fallback이 골든셋을 통과한다"는 회귀 기준선일 뿐입니다.

mock이 틀리는 2건은 `커피 ↔ 아메리카노` 동의어 문제로, 규칙 기반이 풀 수 있는 종류가 아닙니다. **Jev가 이걸 맞히는지가 좋은 리트머스입니다.**

---

## 6. Phase 5A — NutritionResolver 구현 상태 (완료)

데이터 없이도 완성 가능한 deterministic 부분 전부. **85 tests.**

### `quantity.ts` — 한국어 수량 파서 (34 tests)

| 입력 | 결과 |
| --- | --- |
| `밥 한 공기` | 1 · 공기 |
| `계란 세 개` / `메추리알 세개` | 3 · 개 (띄어쓰기 무관) |
| `우유 200ml` | 200 · ml |
| `밥 반 공기` · `밥은 반만` | **0.5** |
| `갈비탕 한 그릇 반` | **1.5** · 그릇 |
| 수량 없음 | `assumed: true`로 1인분 가정, **숨기지 않고 표시** |

단위 32종. `공기밥`이 `공기`로 잘리거나 `만두`가 `만+두`로 읽히지 않음을 테스트로 고정.

### `foodPhrases.ts` — 문장 → 음식 구문 (25 tests)

```
"갈비탕 하나랑 밥 한 공기 먹었어"
  → [{ name:"갈비탕", value:1, unit:null }, { name:"밥", value:1, unit:"공기" }]
```

어미 제거 → 시간/장소 수식어 제거 → 접속 조사 분리 → 구문별 수량 추출.
`와인`이 `와`로, `과자`가 `과`로 쪼개지지 않고, `에서`를 `에`로 오인하지 않습니다.

**이름에서 조사를 떼지 않습니다** — `오이`·`포도`가 `오`·`포`가 되기 때문입니다. 매처가 원형과 조사 제거형을 둘 다 데이터셋에 던져 **데이터가 판정**합니다.

### `dataset.ts` + `localDatasetResolver.ts` (26 tests)

```ts
type PhraseResolution =
  | { status: "resolved";  match: NutritionMatch }
  | { status: "ambiguous"; candidates: NutritionMatch[] }
  | { status: "unknown" };
```

- 매칭 점수: 정확 1.0 → 별칭 → 띄어쓰기 무시 → 조사 제거형 ×0.95 → 접두 0.8 → 포함 0.7. 하한 **0.6** 미만은 `unknown`
- **동점이면 `ambiguous`로 되묻습니다.** `밥`은 흰쌀밥·현미밥 양쪽에 걸리므로 조용히 하나 고르지 않습니다
- 스케일링: `caloriesPer100g × grams / 100`, 정수 반올림. `공기`→g는 항목의 `servings` 표에서
- 모르는 단위 → 기본 1인분 + `estimated: true`. `ml`은 g로 읽되 역시 `estimated`
- `servings`가 없는 항목은 이름이 맞아도 **`unknown`** — 추정하지 않음

### 데이터셋 계약

```ts
{ version: 1,
  source: { name, retrievedAt, license },        // 출처 추적 필수
  entries: [{ id, name, aliases?, caloriesPer100g,
              servings?: [{ unit, grams }], source }] }
```

zod 검증, 깨진 행은 버리고 나머지 유지.

**데이터셋 파일은 아직 없습니다.** 파이프라인만 완성되어 있습니다.

---

## 7. 식약처 API 현재 상태

### 사용할 데이터

**식품의약품안전처_식품영양성분DB정보**
https://www.data.go.kr/data/15127578/openapi.do

| 항목 | 값 |
| --- | --- |
| 이용허락범위 | **제한 없음** (상업 이용 가능) |
| 비용 | 무료 |
| 트래픽 | 개발계정 일 10,000건 |
| 승인 | 개발단계 **자동승인**, 운영단계 심의 |
| 필요한 것 | **활용신청 → API 인증키** |
| 엔드포인트 | `https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03` (`.env.example` 참조) |

### 익명 접근 불가 (실제로 확인함)

| 시도 | 결과 |
| --- | --- |
| `data.go.kr/download/15100070/standard.do?dataType=csv` | **HTTP 404** |
| 식품안전나라 `down/list.do` · `down/info.do` | 200이지만 **JS 기반 선택 플로우 + EUC-KR**, 세션 필요 |
| 공공데이터포털 파일데이터 `15047698` | 포털 **로그인 필요** |

계정 생성은 사용자만 할 수 있습니다. **데이터 투입은 사용자 작업입니다.**

---

## 8. 필요한 외부 자격증명

| 변수 | 용도 | 상태 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Jev 판단 | **waitlist 승인 대기** |
| `MFDS_FOOD_NUTRITION_API_KEY` | 식약처 음식 영양정보 | 활용신청 필요 |
| `MFDS_FOOD_NUTRITION_ENDPOINT` | 위 API 엔드포인트 | `.env.example`에 기재됨 |
| `ANTHROPIC_API_KEY` | LLM fallback 파서 (음식명/수량 추출만) | 선택 — Phase 5B |

사용자가 `.env.example`에 지정해 둔 엔드포인트:

```
MFDS_FOOD_NUTRITION_ENDPOINT=https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03
```

`.env.local`에 값을 넣습니다. **절대 커밋하지 마세요** (`.gitignore` 15행에 있고, 현재 추적되지 않음을 확인했습니다).

> `src/env.ts`의 zod 스키마에는 아직 `MFDS_*` 변수가 없습니다. Phase 5B에서 `optionalSecret` 패턴으로 추가하세요 — 빈 문자열을 "없음"으로 취급하는 기존 방식 그대로.
>
> `.env.example`에 `TYPESAFE_API_KEY=` 가 두 번 들어가 있습니다 (사용자가 추가하면서 중복된 것으로 보임). 동작에는 문제없지만 정리하면 좋습니다.

---

## 9. 키가 확보되면 실행할 순서

### TypeSafe 키가 나오면 (Phase 4.5)

1. `.env.local`에 `TYPESAFE_API_KEY=` 작성
2. `pnpm eval:jev` — 60건 실측
3. 결과 보고: intent / consumption / clarification / reference 정확도, 카테고리별, confidence 분포, **틀린 케이스 전부**, FP/FN, mock과의 차이, latency 분포, `usage` 토큰 수
4. 특히 볼 것: `갈비탕 칼로리 높아?`(non-consumption) · `제육 먹어도 될까?`(recommendation) · `아까 밥 반만 먹었어`(modify) · `커피는 안 마셨음`(delete) · **커피↔아메리카노 동의어** · `그거`/`방금 거`/`아까 거` 대명 표현
5. **reference 전략 A/B/C 결정** (→ §12)
6. **confidence threshold 재조정** + `confidence.test.ts` 동반 수정 + `confidence.ts`의 "미검증" 주석 갱신
7. `architecture.md` §3.1 · §4 갱신 (모델 버전, 결과, 최종 threshold, 전략, 알려진 한국어 약점)

### 식약처 키가 나오면 (Phase 5B)

1. **먼저 실제 API를 한 번 호출해 응답 스키마를 눈으로 확인** (→ §11)
2. 확인된 컬럼명으로 importer 작성 → `dataset.ts`의 `FoodDataset` 형태로 변환
3. 한국인 상용 음식 + 편의점 제품 중심으로 축소한 로컬 데이터셋 번들
4. `servings`(공기/그릇/잔 → g) 매핑 — 원본에 1회 제공량이 있으면 그것부터
5. `aliases` 보강 (아아 → 아이스 아메리카노, 공기밥 → 흰쌀밥)
6. LLM fallback 파서 연결 (선택)

두 작업은 **서로 독립**이므로 먼저 열리는 쪽부터 진행하면 됩니다.

---

## 10. `pnpm eval:jev` 사용법

```bash
# 실제 Jev — TYPESAFE_API_KEY 필요 (.env.local 자동 로드)
pnpm eval:jev

# 규칙 기반 fallback 기준선 — 키 불필요
EVAL_JUDGE=mock pnpm eval:jev
```

- 키가 없으면 **안내 문구를 출력하고 정상 종료**합니다. CI가 키 없다고 실패하지 않습니다
- 60건을 **동시성 5**로 호출합니다 (Jev rate limit 1,200 req/min이라 여유 있음)
- 비용은 무시 가능한 수준입니다 (입력 $0.042/1M 토큰, 출력 무료)
- 출력: 전체 정확도 · 카테고리별 intent · confidence 분포 · 섭취 오탐/미탐 · intent 오분류 전체 · reference 오분류 · clarification 오분류
- 구현: `scripts/evalJev.eval.ts`, 설정 `vitest.eval.mts`. **테스트가 아니라 리포트**이며 실패해도 빌드를 깨지 않습니다 (vitest는 러너로만 재사용 — TS와 `@/` alias를 공짜로 얻으려고)

---

## 11. ⚠️ importer는 실제 응답을 본 뒤에 작성할 것

**보지 않은 컬럼명을 추측해서 importer를 구현하면 안 됩니다.**

식약처 응답 필드명(`DESC_KOR`, `NUTR_CONT1`, `SERVING_SIZE` 등)은 데이터셋 버전마다 다르고, 문서에 적힌 것과 실제 응답이 어긋나는 경우가 흔합니다. 추측으로 쓴 importer는 **조용히 잘못된 칼로리를 넣습니다** — 이 프로젝트에서 가장 피해야 할 실패입니다.

절차:

1. 인증키로 실제 API를 1회 호출
2. 원본 JSON을 그대로 출력해 **필드명·단위·1회 제공량 표기 방식을 눈으로 확인**
3. 확인된 필드만 매핑
4. 매핑하지 못한 필드는 버리지 말고 로그로 남겨 보고

---

## 12. 아직 확정하지 않은 사항

### confidence thresholds — **미확정**

`src/ai/judgment/confidence.ts`의 현재 값은 TypeSafe 공식 문서 권장(>0.9 auto / 0.5–0.9 confirm / <0.5 clarify)을 액션 위험도별로 조정한 **출발점**입니다.

| intent | auto | confirm | clarify |
| --- | --- | --- | --- |
| ask_status / ask_recommendation / other | ≥ 0.5 | — | < 0.5 |
| add_food | ≥ 0.9 | 0.5~0.9 | < 0.5 |
| modify_food | ≥ 0.9 | 0.5~0.9 | < 0.5 |
| delete_food | ≥ 0.95 | 0.7~0.95 | < 0.7 |

noul: `actualConsumption ≥ 0.5`, `clarificationNeeded ≥ 0.5`, reference 하한 0.5.

**delete는 false positive 최소화를 최우선으로** 조정하세요.

### reference strategy — **미결정**

| | 전략 | 채택 조건 |
| --- | --- | --- |
| **A** | Jev reference 유지 | 한국어 reference 정확도가 안정적 |
| **B** | Hybrid — intent/consumption/clarification은 Jev, reference는 코드 휴리스틱 우선, 모호할 때만 Jev/clarify | intent는 좋은데 reference가 약함 |
| **C** | reference 전면 코드 이동 | Jev reference가 불안정 |

B/C에 필요한 코드는 **이미 있습니다**: `mockJudge.ts`의 `resolveReferenceByName()` — 이름 부분일치 → 동률이면 최근순, 조사 제거 후 재시도, `방금`이면 최신 항목. 골든셋에서 90%입니다.

---

## 13. Phase 5B / Phase 6 TODO

### Phase 5B (데이터 필요)

- [ ] 식약처 OpenAPI 실제 응답 스키마 확인 (§11)
- [ ] importer 작성 → `FoodDataset` JSON 생성
- [ ] 로컬 데이터셋 번들 (한국 상용 음식 + 편의점 제품)
- [ ] `servings` 매핑 (공기/그릇/잔 → g)
- [ ] `aliases` 보강
- [ ] LLM fallback 파서 (선택, `ANTHROPIC_API_KEY`) — **음식명/수량 추출만. 칼로리 생성 금지**

### Phase 6 (일부는 지금도 가능)

- [ ] `add_candidate` → 실제 `AddMealRecord` 연결. `addMealRecord`/`updateMealRecord`/`deleteMealRecord`는 Phase 3부터 구현·테스트되어 있고 **호출부만 없습니다**
- [ ] **delete는 NutritionResolver 없이도 완성 가능** — 순수 도메인 연산. 데이터 대기 중에 먼저 연결해도 됩니다
- [ ] `ambiguous` / `unknown` 응답 UX 연결 (clarify 칩 UI는 이미 있음)
- [ ] 추천 로직 (남은 칼로리 + 단백질 부족 여부 정도. 복잡한 생성형 코칭 금지)
- [ ] `docs/typesafe.ai/model-jaggedness/jev-1.13` 읽기 — Phase 0에서 인덱스만 보고 미독
- [ ] 목록이 길어질 때 `TodaySummary` 상단 고정 여부 판단

### 장기 아이디어 (지금 넣지 말 것)

사용자 메모: `갈비탕 칼로리 높아?` / `삼각김밥 하나 더 먹으면 넘을까?` 같은 read-only 질문이 실사용에서 많을 것이므로 **`nutrition_question` intent가 생길 가능성이 높습니다.** 다만 **지금 추가하지 마세요** — 실사용에서 필요성이 드러날 때 넣는 게 맞습니다. 현재는 `other`로 처리되고 "먹은 걸 말씀해주시면 기록할게요."로 응답합니다.

---

## 14. 테스트 수와 마지막 검증 결과

**2026-09-20, Phase 5A 커밋 직전 기준**

| | |
| --- | --- |
| `pnpm typecheck` | ✅ exit 0 |
| `pnpm lint` | ✅ exit 0, 경고 0 |
| `pnpm test` | ✅ **15 files / 287 tests** |
| `pnpm build` | ✅ `/` static, `/api/chat` dynamic |
| `pnpm eval:jev` | ⚠️ 키 없음 → 안내 후 skip (정상) |
| `EVAL_JUDGE=mock pnpm eval:jev` | ✅ intent 100% · consumption 100% · clarification 96.7% · reference 90% (**기준선일 뿐**) |

테스트는 **네트워크를 전혀 호출하지 않습니다.** Jev adapter는 stub client 주입, repository는 in-memory storage 주입 (jsdom 없음).

### 브라우저 QA (Chrome, mock fallback)

320 / 375 / 390 / 430 / 768 / 1280px 전부 **가로 overflow 0**, sticky 입력 고정, 대비 4.74~10.37 전부 WCAG AA 통과, 터치 타깃 44px.

---

## 15. 다음 세션에 읽을 파일

순서대로:

1. **`docs/HANDOFF.md`** ← 이 파일
2. `docs/architecture.md` — 상태 경계 6규칙, 확신도 정책, 데이터 확보 상태, 데이터셋 계약
3. `README.md` — 목적·UX·스택·Phase 표·현재 막혀 있는 것
4. `src/ai/judgment/types.ts` — Judgment 타입과 choice/noul 구분의 이유
5. `src/ai/judgment/confidence.ts` — 임계값과 "미검증" 상태 주석
6. `src/application/commands.ts` — Command 계약과 분기 로직
7. `fixtures/korean-inputs.json` — 골든셋 60건 (기대값은 *맞는 답*이지 모델의 현재 답이 아님)
8. `src/ai/nutrition/localDatasetResolver.ts` — `resolved`/`ambiguous`/`unknown` 세 상태

TypeSafe 작업 시에는 `/typesafe:typesafe-ai` skill이 project scope에 설치되어 있습니다. **live docs가 source of truth이므로 추측하지 말 것.** SDK API는 `node_modules/@typesafe-ai/sdk/dist/index.d.mts`가 가장 정확합니다 (공개 문서 페이지는 요약적임).

---

## 16. Git 상태

마지막 커밋: **`0bb84b7` feat: integrate Jev judgment pipeline** (Phase 4)

이번 세션에서 Phase 5A를 커밋합니다 (`feat: add deterministic nutrition resolution pipeline`):

```
신규  src/ai/nutrition/{quantity,foodPhrases,dataset,localDatasetResolver,types}.ts
신규  src/ai/nutrition/{quantity,foodPhrases,localDatasetResolver}.test.ts
신규  docs/HANDOFF.md
변경  src/ai/judgment/confidence.ts   (미검증 상태 명시)
변경  docs/architecture.md            (§3.1 검증 상태, 데이터 확보 상태, 데이터셋 계약)
변경  README.md                       (Phase 표, "지금 막혀 있는 것")
삭제  src/ai/nutrition/.gitkeep
```

커밋 후 워킹 트리는 clean이어야 합니다. push는 하지 않았습니다 (사용자 지시 없음).

> 참고: `AGENTS.md` / `CLAUDE.md`는 Next.js가 `next/dist/server/lib/generate-agent-files.js`에서 자동 생성합니다. 지워도 `pnpm dev`가 되살리므로 커밋된 상태로 둡니다.

---

## 17. 🚫 다음 작업자가 절대 하면 안 되는 것

1. **임의 칼로리 생성 금지.** 데이터셋에 없는 음식에 그럴듯한 숫자를 붙이지 마세요. 답은 `unknown`이고 앱은 되묻습니다. 테스트 픽스처의 숫자를 제품 데이터로 승격시키지도 마세요 (`source: "test-fixture"`로 표시되어 있습니다). LLM은 음식명·수량을 **파싱**만 하고 값을 매기지 않습니다.
2. **Jev 실측 없이 threshold 확정 금지.** `confidence.ts`의 숫자는 baseline입니다. `pnpm eval:jev` 결과 없이 "조정했다"고 하지 마세요. mock 점수는 근거가 아닙니다 — 그 규칙은 같은 골든셋을 보고 썼습니다.
3. **reference 전략 추측 결정 금지.** A/B/C는 실측 결과로만 고릅니다.
4. **secret 커밋 금지.** `.env.local`은 `.gitignore`에 있습니다. 커밋 전 항상 스캔하세요.
5. **choice confidence와 noul probability를 같은 helper로 처리하지 마세요.** 타입과 함수가 분리되어 있는 것이 의도입니다.
6. **수동 CRUD UI를 메인 화면에 추가하지 마세요.** 이 앱의 수정 수단은 자연어입니다.
7. **서버가 도메인 상태를 바꾸게 하지 마세요.** 서버는 Command만 반환합니다.
8. 데이터가 없다는 이유로 **Phase를 억지로 "완료" 처리하지 마세요.** 막힌 것은 막혔다고 적습니다.
