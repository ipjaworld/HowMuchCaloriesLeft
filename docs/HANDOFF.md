# HANDOFF

> 마지막 갱신: **2026-09-24** · 상태: **MVP v0.1 — production 배포 완료.**

다음 세션에서 이 파일부터 읽으면 컨텍스트 없이 바로 이어갈 수 있습니다.

---

## 0. 지금 상태 요약 (배포 담당자용)

| | |
| --- | --- |
| production 기준 | `d9c7328` chore: ignore Vercel project metadata |
| working tree | clean |
| 완료 Phase | 0 · 1 · 2 · 3 · 4 · 4.5 · 5A · 5B · 6A · 6B |
| 상태 | **MVP v0.1 production 배포 완료.** 자연어 기록·수정·삭제가 실제로 동작 |
| 다음 할 일 | 실제로 며칠 사용하면서 반복되는 `unknown`만 기록 (§19) |

### 런타임 환경변수 — 하나뿐

```
TYPESAFE_API_KEY     선택. 없으면 mock 판단으로 앱 전체 정상 동작
```

### 동기화 전용 — Vercel에 넣지 않아도 됨

```
MFDS_FOOD_NUTRITION_API_KEY    scripts/syncMfdsDataset.sync.ts 에서만 사용
MFDS_FOOD_NUTRITION_ENDPOINT   같은 스크립트. 기본값 있음
```

### 아직 미사용

```
ANTHROPIC_API_KEY    src/env.ts 스키마에만 존재. 호출하는 코드 없음
```

**위는 추측이 아니라 `grep`으로 사용처를 전부 추적한 결과다.** 런타임 경로(`src/app/`)에서 MFDS 변수를 읽는 코드는 없다.

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
| 5A | deterministic nutrition pipeline | `c54420f` |
| **4.5** | **Jev 한국어 실측 · 임계값 확정 · reference 전략 A** | **이번 커밋** |
| **5B** | **식약처 OpenAPI 연결 · 번들 데이터셋** | **이번 커밋** |
| **6A** | **add_food end-to-end — 실제 저장까지** | **이번 커밋** |
| **6B** | **modify / delete 실제 반영** | **이번 커밋** |

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
                        · referenceHeuristic        ← 4.5에서 mockJudge에서 분리
    nutrition/          quantity · foodPhrases · dataset · localDatasetResolver · types
                        · koreanFoods               ← 번들 데이터셋 로더
      mfds/             client · importer · seeds   ← 5B, 식약처 경계
  components/           TodayScreen(유일한 "use client") · TodaySummary · MealList
                        · ChatInput · GoalEditor · replyText
data/                   korean-foods.json (생성물, 커밋됨)
fixtures/               korean-inputs.json (골든셋 60건)
                        mfds-sample.json  (실제 식약처 응답 원본)
scripts/                evalJev.eval.ts · syncMfdsDataset.sync.ts
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
| 확신도 정책 | **실측으로 확정** (→ §5) |
| mock fallback | 완료 — 키 없이 앱 전체 정상 동작 |
| **실제 Jev 호출** | **검증 완료** — 골든셋 60건 × 2회 |

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

## 5. Phase 4.5 결과 — 실측 완료

2026-09-23 · `jev-1.13.0` · 골든셋 60건.

| 항목 | 결과 |
| --- | --- |
| intent | 93.3~95.0% (재실행 간 1건 흔들림) |
| actual_consumption | 96.7% |
| reference_target | **95.0%** |
| needs_clarification | 35.0% → **73.3%** (임계값 조정 후) |
| latency | p50 261ms · p90 305ms |
| 비용 | 60건에 $0.0027 (input 65k 토큰, output 무료) |

전체 분석은 [`architecture.md` §3.1](architecture.md). 여기서는 **다음 작업자가 되돌리기 쉬운 것**만 적는다.

### 확정된 것 세 가지

1. **reference 전략 = A.** Jev가 고르고, `referenceConfidence < 0.5`면 버리고 `referenceHeuristic.ts`가 받는다. 근거: Jev 95% > mock 90%, 그리고 **맞은 19건 전부 ≥0.74 / 틀린 1건 0.29** — 자기가 틀렸을 때를 스스로 알려준다. 동의어(커피↔아메리카노)는 규칙으로 못 푸는데 Jev는 푼다.
2. **임계값 확정.** modify auto 0.9→0.85, 읽기전용 confirm 0.3→0.5, clarification noul 0.5→**0.85**. delete는 0.95 **유지** (오탐 0건은 낮춰도 된다는 증거가 아니다).
3. **모호함 ≠ 파괴성.** `점심 기록 지워줘`(clarification 0.34)에서 Jev는 옳다 — 대상이 분명하다. 확인이 필요한 건 되돌리기 어려워서다. 그래서 **대상이 하나로 안 좁혀진 삭제는 코드가 언제나 되묻는다.** noul에 이 판단을 맡기지 말 것.

### ⚠️ needs_clarification은 믿을 만한 신호가 아니다

분포가 거의 완전히 겹친다 — 물어야 할 케이스 0.34~0.94, 물 필요 없는 케이스 0.19~0.93. **어떤 임계값도 못 가른다.** 0.85는 운용점이지 분리점이 아니고, 골든셋에서 여전히 8건을 불필요하게 되묻는다 (`점심에 갈비탕 먹음` 0.86 등).

**Phase 6A에서 그렇게 했다**: `add_food`의 "어떤 음식을 얼마나"는 `NutritionResolver`가 `resolved`/`ambiguous`/`unmeasurable`/`unknown`으로 **확정적으로** 답하므로, add 경로는 이 noul을 아예 보지 않는다. `ClarifyReason.unclear_food`도 만들어낼 주체가 없어져 지웠다. modify/delete에서는 계속 쓴다 — 어떤 *기록*을 가리키는지는 데이터셋이 모른다.

### 남은 약점 (고치지 않았음, 영향 없음)

- `편의점 도시락 괜찮아?` 등 3건: `other` 기대 → `ask_recommendation`. 확신 있게 틀려서 임계값으로 못 잡는다. 둘 다 읽기 전용이라 **동작 차이 없음**. 골든셋 경계 자체가 모호하니 픽스처를 고칠지는 사용자 판단.
- `라면` 같은 맨 음식명: consumption 0.45로 기록 안 됨. 임계값을 내리면 `아침에 먹은 거 칼로리 얼마야?`(0.64)가 샌다.

## 6. Phase 5A — NutritionResolver 구현 상태 (완료)

데이터 없이도 완성 가능한 deterministic 부분 전부. 아래 개수는 **현재 기준**이며, 5A 이후 단계에서 같은 파일에 테스트가 더 붙었다 (5A 시점에는 85개였다).

### `quantity.ts` — 한국어 수량 파서 (41 tests)

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

### `dataset.ts` + `localDatasetResolver.ts` (38 tests)

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
- `servings`가 없는 항목은 이름이 맞아도 무게를 못 구함 → **`unmeasurable`** (추정하지 않되 `unknown`과 구분)

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

## 7. 식약처 API — 연결 완료 (Phase 5B)

```
GET https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03
    ?serviceKey=...&pageNo=1&numOfRows=100&type=json&FOOD_NM_KR=갈비탕
```

응답 `{ header:{resultCode,resultMsg}, body:{totalCount, items:[...] } }` · 전체 **331,212행** · JSON 지원 · `serviceKey`는 디코딩 키 그대로.

### 다음 작업자가 반드시 알아야 할 두 가지

**1. 영양소가 이름 없는 번호 컬럼이다.** `AMT_NUM1`~`AMT_NUM157`. `AMT_NUM1`이 에너지라는 건 가정이라서, importer가 단백질(3)·지방(4)·탄수(6)에 Atwater 4/9/4를 적용해 검산하고 어긋나면 행을 버린다. 700행 표본 중 네 값이 다 있는 602행에서 584행이 15% 이내로 일치했다. **이 검산을 제거하지 말 것** — 컬럼 순서가 바뀌면 조용히 틀린 칼로리가 들어간다.

**2. 이름 검색은 부분 일치라 위험하다.** 실제로 확인한 것:

| 검색 | 돌아오는 것 |
| --- | --- |
| `커피` | 커피번 389 kcal/100g |
| `아메리카노` (정확 일치!) | 인스턴트 분말 200 kcal/100g (내린 커피는 4) |
| `바나나` (정확 일치!) | 바나나맛 과자 454 kcal/100g |
| `갈비탕` | 품목대표만 6행, 27~89 kcal/100g |

**정확 일치조차 안전하지 않다.** 그래서 `seeds.ts`는 손으로 확인한 `FOOD_CD`를 직접 지정한다. 항목을 추가하려면 먼저 그 음식을 조회해서 **행을 눈으로 보고** 코드를 적어라. 이름만 넣고 늘리지 말 것.

### 적재 방식

`pnpm sync:mfds` (오프라인) → `data/korean-foods.json` (커밋됨) → `koreanFoods.ts` → 기존 `localDatasetResolver`.

live query를 쓰지 않는 이유: 331k행은 번들 불가, 요청 시점 선택은 위 함정을 그대로 밟음, 호출당 ~300ms에 일 10,000건 제한 vs 로컬 0ms, 그리고 기존 resolver와 테스트가 이미 이 형태를 소비한다. **테스트는 네트워크를 타지 않는다.**

### 1인분 정보 — 있을 때만

그램 수는 **언제나 행이 명시한 값**(`Z10500` 1인분 총중량 / `NUTRI_AMOUNT_SERVING` 표시 제공량). 두 값이 기준(100g/100mL)과 같으면 "정보 없음"으로 읽는다. 단위 **이름**(공기·그릇·잔)만 `seeds.ts`가 정하고 **크기는 절대 정하지 않는다.**

현재 14개 중 11개는 1인분 정보 있음, 3개는 없음 → `unknown`:

- **삶은 달걀** — MFDS에 개당 무게가 없다
- **아메리카노** — 잔 용량이 없다
- **삼각김밥** — 행의 200g이 한 개가 아님

이건 버그가 아니다. 채우지 말 것.

## 8. 외부 자격증명

사용처를 `grep`으로 전부 추적한 결과다. **런타임에 필요한 것과 오프라인 전용을 섞지 말 것.**

| 변수 | 실제 사용처 | 런타임 필요? |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | `src/app/api/chat/route.ts` | **예** (없으면 mock으로 동작) |
| `MFDS_FOOD_NUTRITION_API_KEY` | `scripts/syncMfdsDataset.sync.ts` | 아니오 — 데이터셋 재생성 전용 |
| `MFDS_FOOD_NUTRITION_ENDPOINT` | 같은 스크립트 | 아니오 (기본값 있음) |
| `ANTHROPIC_API_KEY` | **없음.** 스키마에만 존재 | 아니오 |

전부 `optionalSecret`이라 없어도 앱은 뜬다. `.env.local`은 `.gitignore`에 있고 추적되지 않는다. **커밋 전 항상 확인할 것.**

> `src/env.ts`의 `hasTypeSafeKey` / `hasMfdsKey` / `hasLlmFallbackKey`는 현재 **아무도 import하지 않는다.** 세 키의 선택적 상태를 문서화하는 용도로 남겨뒀다. 정리해도 되고 그대로 둬도 동작에 영향은 없다.

---

## 9. 두 키로 실제로 한 일

**TypeSafe** — `pnpm eval:jev`로 골든셋 60건 2회 측정 → §5. `jevJudge`에 `onCall` 텔레메트리 훅을 넣어 모델명·토큰·latency를 리포트에 찍는다 (`Judgment` 타입은 건드리지 않았다 — 앱이 쓰지 않는 값이라).

**식약처** — 실제 응답을 먼저 눈으로 확인한 뒤 importer를 작성했고(→ §7), `pnpm sync:mfds`로 14개 항목을 `data/korean-foods.json`에 기록했다.

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

## 11. importer 작성 원칙 (지켜졌음 — 계속 지킬 것)

**보지 않은 컬럼명을 추측해서 구현하지 않는다.** Phase 5B에서 실제로 밟은 순서:

1. 인증키로 실제 API 호출 → 원본 JSON을 그대로 출력
2. 필드명·단위·1회 제공량 표기를 **눈으로 확인** (700행 표본)
3. 확인된 필드만 매핑
4. 매핑할 수 없는 행은 버리고 **이유와 함께 보고** (`ImportIssue`)

여기에 더해, `AMT_NUM1`이 에너지라는 가정을 **런타임에 검산**하게 만들었다. 추측으로 쓴 importer가 조용히 틀린 칼로리를 넣는 것이 이 프로젝트에서 가장 피해야 할 실패이므로, 검산이 실패하면 행을 버린다.

## 12. 확정된 사항 (근거는 §5, 상세는 architecture.md)

### confidence thresholds — **확정**

| intent | auto | confirm | clarify |
| --- | --- | --- | --- |
| ask_status / ask_recommendation / other | ≥ 0.5 | (없음) | < 0.5 |
| add_food | ≥ 0.9 | 0.5~0.9 | < 0.5 |
| modify_food | ≥ **0.85** | 0.5~0.85 | < 0.5 |
| delete_food | ≥ 0.95 | 0.7~0.95 | < 0.7 |

noul: `actualConsumption ≥ 0.5`, `clarificationNeeded ≥ **0.85**`, reference 하한 0.5.

각 숫자의 근거가 `confidence.ts` 주석에 케이스와 함께 있고, `confidence.test.ts`의 `measured operating points` 블록이 고정한다. **테스트가 깨지면 측정된 trade-off를 바꾸는 것이니 근거를 갱신하고 바꿀 것.**

### reference strategy — **A 채택**

Jev가 고르고, 확신이 낮으면(`< 0.5`) 코드 휴리스틱이 받는다. 구현은 `commands.ts`의 `usableTarget()`.

**표본은 60건 한 번**이다. delete·other는 예측 건수가 한 자리다. 같은 픽스처 두 실행에서 confidence가 최대 0.03 흔들렸으므로 **0.01 단위 튜닝은 노이즈를 맞추는 것.**

## 13. Phase 6A·6B 결과

### 연결된 것

말 → 저장/수정/삭제가 전부 이어졌다. 구조는 [`architecture.md` §4.1·§4.2](architecture.md).

```
/api/chat     judgment → add/modify 확장(NutritionResolver) → 타입화된 command
/api/resolve  수량 후속 입력 전용. 음식을 **이름**으로 찾는다 (Jev 거치지 않음)
PendingAdd    add와 modify가 공유하는 대화 상태. target이 있으면 수정
editFood      item이 속한 record를 찾아 기존 update/delete 함수를 고른다
```

### 되돌리면 안 되는 결정 (6A 넷 + 6B 넷)

1. **한 문장은 한 기록.** 부분 저장 금지.
2. **PendingAdd는 client 상태.** 새로고침하면 사라지는 게 맞다.
3. **add_food는 clarification noul을 보지 않는다.** resolver가 데이터로 답한다.
4. **중간 확신도에서도 조회는 한다.** add·modify 모두. "네"에 적용할 것이 남아야 한다.
5. **새 CRUD를 만들지 않았다.** `editFood`는 Phase 3의 update/delete 중 무엇을 부를지만 정한다.
6. **삭제는 스스로 동점을 깨지 않는다.** 지목이 갈리고 후보가 서로 다르면 언제나 되묻는다 — 모델이 골랐든 휴리스틱이 골랐든. (수정에는 적용하지 않는다: 보이고 되돌릴 수 있다.)
7. **수정은 add 파이프라인을 재사용한다.** 평행 구조를 만들지 말 것. 얹은 것은 `preferTargetFood`와 `namesASubstitution` 둘뿐이다.
8. **수정해도 item의 `id`와 record의 `sourceText`는 유지한다.** 원래 한 말은 정정이 덮어쓸 대상이 아니다.

### ⚠️ 알려진 한계 — 정정 문법

`foodPhrases`는 **add 문법에 맞춰 만든 것**이라 정정 문법을 다 읽지 못한다. 실측:

| 입력 | 파싱 |
| --- | --- |
| `아까 밥 반만 먹었어` | ✅ "밥" + 0.5 |
| `갈비탕 반 그릇만 먹었어` | ❌ 문장 전체가 이름, 1인분 가정 |
| `아까 밥은 절반 정도 남겼어` | ❌ `남겼어`를 어미로 못 읽음 |
| `아메리카노 말고 라떼였어` | ❌ (라떼는 데이터셋에도 없음) |

읽지 못하면 **양을 되묻는다**(`isSameAs`로 "바뀐 게 없음"을 감지). 틀린 값을 저장하지는 않는다.

다음에 손댄다면: `foodPhrases`에 정정 문법(`남겼어`, `N만`, `말고 X`)을 추가하고 **골든셋 픽스처로 회귀를 고정**할 것. 25개 기존 테스트를 깨기 쉬우므로 지금은 건드리지 않았다.

> 다음에 할 일은 **§19 우선순위**에 정리되어 있다. 여기서는 반복하지 않는다.

### 장기 아이디어 (지금 넣지 말 것)

`갈비탕 칼로리 높아?` 같은 read-only 질문이 실사용에서 많을 것이므로 **`nutrition_question` intent가 생길 가능성이 높습니다.** 다만 지금 추가하지 마세요. 현재는 `other`로 처리됩니다.

> 참고: 실측에서 Jev가 이런 문장 일부를 `ask_recommendation`으로 읽습니다(§5). intent를 하나 더 만들 때 이 경계를 같이 정리하는 게 좋습니다.

## 14. 마지막 검증 결과

**2026-09-23, Phase 6B 커밋 직전**

| | |
| --- | --- |
| `pnpm typecheck` | ✅ exit 0 |
| `pnpm lint` | ✅ exit 0, 경고 0 |
| `pnpm test` | ✅ **21 files / 463 tests** (6A 시점 445 → +18) |
| `pnpm build` | ✅ `/` static, `/api/chat` · `/api/resolve` dynamic |
| `pnpm eval:jev` | Phase 4.5 이후 판단 로직 변화 없음 (재실행 불필요) |
| `pnpm sync:mfds` | 6A에서 재생성됨, 6B에서 데이터 변경 없음 |

`pnpm test`는 **네트워크를 전혀 호출하지 않는다.**

### 브라우저 QA (Chrome, 실제 Jev + 실제 데이터셋)

**삭제** — `김밥 삭제해줘` 단일 item record 통째 삭제(1,397→1,075) · `갈비탕 삭제해줘` 2-item record에서 하나만 제거하고 쌀밥 유지(713→351) · **`밥 지워줘`로 쌀밥/김밥이 갈릴 때 되묻고 선택 후 삭제**(673→322).

**수정** — `아까 밥 반만 먹었어` → 확인 후 쌀밥 351→175 (item id·sourceText 유지, 713→537) · `아까 갈비탕 아니고 김치찌개 한 그릇 먹었어` → `무엇으로 바꿀까요?` → 김치찌개 90으로 교체(362→90) · 취소 시 기록 그대로.

**회귀** — add 시나리오(resolved / ambiguous / unmeasurable+200ml / unknown / status) 전부 6A와 동일. 새로고침 후 수정·삭제 결과 유지. 가로 overflow 320~768px 0, 하단 바 183px로 6A와 동일.

**단위 테스트로만 확인한 것**: 대상이 사라진 뒤의 수정/삭제(`not_found` → 저장소 무변경). 삭제 confirm 구간의 "아니요"는 QA 중 Jev가 그 구간을 내주지 않아 코드 경로로만 확인했다.

## 15. 다음 세션에 읽을 파일

순서대로:

1. **`docs/HANDOFF.md`** ← 이 파일
2. `docs/architecture.md` — 상태 경계 6규칙, 확신도 정책, 데이터 확보 상태, 데이터셋 계약
3. `README.md` — 목적·UX·스택·Phase 표·지금 어디까지 되나
4. `src/ai/judgment/types.ts` — Judgment 타입과 choice/noul 구분의 이유
5. `src/ai/judgment/confidence.ts` — 임계값과 **각 값의 실측 근거**
6. `src/application/commands.ts` — Command 계약, 분기 로직, reference fallback
7. `fixtures/korean-inputs.json` — 골든셋 60건 (기대값은 *맞는 답*이지 모델의 현재 답이 아님)
8. `src/ai/nutrition/localDatasetResolver.ts` — `resolved`/`ambiguous`/`unknown` 세 상태
9. `src/ai/nutrition/mfds/seeds.ts` — 왜 이름이 아니라 `FOOD_CD`로 고르는지
10. `src/application/addFood.ts` · `pendingAdd.ts` — 한 문장이 한 기록이 되는 과정
11. `src/application/editFood.ts` — item과 record 사이의 틈을 건너는 곳
12. `src/components/TodayScreen.tsx` — 위 셋을 순서대로 호출하는 유일한 곳

TypeSafe 작업 시에는 `/typesafe:typesafe-ai` skill이 project scope에 설치되어 있습니다. **live docs가 source of truth이므로 추측하지 말 것.** SDK API는 `node_modules/@typesafe-ai/sdk/dist/index.d.mts`가 가장 정확합니다 (공개 문서 페이지는 요약적임).

---

## 16. Git 상태

MVP v0.1까지의 커밋 이력:

```
dd833cf  feat: log, correct and delete food from natural language   ← Phase 6A + 6B
e1218c9  fix: refine nutrition resolution semantics and serving-aware matching
dff8eb0  feat: build the nutrition dataset from the MFDS open API
2c88b13  feat: measure Jev on Korean and settle the confidence policy
a87f177  feat: count a bare food name as one natural unit
ec08b1d  design: rework the screen as a light assistant, not a dashboard
c54420f  feat: add deterministic nutrition resolution pipeline
0bb84b7  feat: integrate Jev judgment pipeline
5643701  feat: add calorie domain and local persistence
631871f  feat: build calorie tracking ui shell
8963eac  chore: bootstrap project foundation
```

6A와 6B는 한 커밋으로 묶었다. `editFood.ts` 외의 파일은 6B가 6A의 코드를 같은 함수 안에서 고쳤기 때문에, 분리하려면 중간 상태를 손으로 복원하고 따로 검증해야 했고 얻는 것은 이력의 모양뿐이었다. Phase 경계는 `architecture.md` §4.1·§4.2에 문서로 남아 있다.

`main`은 production 배포 기준 commit `d9c7328`까지 GitHub에 push했다.

## 17. 🚫 다음 작업자가 절대 하면 안 되는 것

1. **임의 칼로리 생성 금지.** 데이터셋에 없는 음식에 그럴듯한 숫자를 붙이지 마세요. 답은 `unknown`이고 앱은 되묻습니다. 테스트 픽스처의 숫자를 제품 데이터로 승격시키지도 마세요 (`source: "test-fixture"`로 표시되어 있습니다). LLM은 음식명·수량을 **파싱**만 하고 값을 매기지 않습니다.
2. **실측 없이 threshold 바꾸기 금지.** 지금 값들은 측정된 trade-off입니다. `confidence.test.ts`의 `measured operating points`가 고정하고 있으니, 그게 깨지면 근거를 새로 만들어서 바꾸세요. mock 점수는 여전히 근거가 아닙니다.
3. **reference 전략은 A로 정해졌습니다.** 바꾸려면 새 측정이 필요합니다.
4. **secret 커밋 금지.** `.env.local`은 `.gitignore`에 있습니다. 커밋 전 항상 스캔하세요.
5. **choice confidence와 noul probability를 같은 helper로 처리하지 마세요.** 타입과 함수가 분리되어 있는 것이 의도입니다.
6. **수동 CRUD UI를 메인 화면에 추가하지 마세요.** 이 앱의 수정 수단은 자연어입니다.
7. **서버가 도메인 상태를 바꾸게 하지 마세요.** 서버는 Command만 반환합니다.
8. 데이터가 없다는 이유로 **Phase를 억지로 "완료" 처리하지 마세요.** 막힌 것은 막혔다고 적습니다.
9. **`AMT_NUM1` 검산을 제거하지 마세요.** 식약처 영양소 컬럼에는 이름이 없습니다. 검산이 사라지면 컬럼 순서가 바뀌는 날 조용히 틀린 칼로리가 들어갑니다.
10. **이름으로 음식을 고르지 마세요.** `아메리카노` 정확 일치조차 인스턴트 분말(200 kcal/100g)을 물어옵니다. `FOOD_CD`를 눈으로 확인하고 `seeds.ts`에 넣으세요.
11. **1인분 무게를 지어내지 마세요.** 삶은 달걀·아메리카노·삼각김밥이 `unmeasurable`인 건 버그가 아니라 데이터에 없기 때문입니다.
12. **되묻는 도중에 일부만 저장하지 마세요.** 한 문장은 한 기록입니다. 부분 저장은 취소를 복잡하게 만듭니다.
13. **PendingAdd를 localStorage나 서버 세션에 넣지 마세요.** 반쯤 끝난 질문은 데이터가 아닙니다.
14. **add_food에서 clarification noul을 다시 끌어들이지 마세요.** resolver가 확정적으로 답하는 질문입니다.
15. **삭제가 스스로 동점을 깨게 하지 마세요.** 최근 것을 고르는 규칙은 수정용입니다. 삭제는 되묻습니다.
16. **수정용 평행 구조를 만들지 마세요.** add 파이프라인과 `PendingAdd`를 그대로 씁니다.
17. **수정할 때 item의 `id`나 record의 `sourceText`를 바꾸지 마세요.**

---

## 18. Vercel 배포 체크리스트 및 결과

### Production 배포 결과

| 항목 | 결과 |
| --- | --- |
| 배포일 | **2026-09-24** |
| Production URL | **https://how-much-calories-left.vercel.app** |
| 배포 상태 | **READY** |
| 배포·스모크 기준 commit | `d9c732802c635688196039268acb234c2a3020fd` |
| Runtime env | `TYPESAFE_API_KEY` — Production Secret |
| 영양 데이터 | `data/korean-foods.json` bundled file 사용. MFDS runtime 호출 없음 |
| Production smoke test | **PASS** — 목표·추가·모호성 질문·양 후속 질문·상태 조회·수정·삭제·unknown 미저장·새로고침 복원 |
| 기술 확인 | `/api/chat` Jev path, `/api/resolve`, localStorage, pending interaction, sticky input, 375px·430px·desktop 모두 PASS |

아래는 배포 전에 코드에서 확인한 체크리스트다.

### 확인된 것 (이 세션에서 실제로 검사함)

| 항목 | 결과 |
| --- | --- |
| Next.js 16 App Router 구조 | ✅ `/` static, `/api/chat`·`/api/resolve` dynamic |
| `engines.node` | ✅ `>=20` |
| `packageManager` | ✅ `pnpm@12.5.1`, `pnpm-lock.yaml` 존재 (160KB) |
| production build | ✅ `pnpm build` 통과, `pnpm start`로 실사용 QA 완료 |
| `@typesafe-ai/sdk` 서버 번들 | ✅ `/api/chat`에서만 import. 브라우저에서 생성 거부하는 SDK라 클라이언트로 샐 경로가 없음 |
| `data/korean-foods.json` | ✅ `koreanFoods.ts`가 정적 import → 번들에 포함. 런타임 파일 읽기 없음 |
| `localStorage` 경계 | ✅ `src/infrastructure/storage.ts` 한 곳에서만. `typeof window === "undefined"`면 no-op storage 반환 → SSR/prerender 안전 |
| `process.loadEnvFile` (Node 전용) | ✅ `scripts/`에만. 런타임 경로에 없음 |
| `node:fs` import | ✅ `src/ai/judgment/goldenSet.ts` 하나뿐이고 **런타임에서 아무도 import하지 않는다** (테스트·eval 전용) |
| sync 스크립트 빌드 중 실행 | ✅ `build`는 `next build`뿐. sync/eval은 별도 명령 |
| `.env.local` | ✅ `.gitignore` 15행, 미추적 |
| `NEXT_PUBLIC_*` secret | ✅ 하나도 없음 |
| `src/env.ts` 클라이언트 유출 | ✅ import하는 곳은 `/api/chat` 하나뿐 |

### 배포 시 확인한 설정

1. **Vercel 프로젝트 설정** — Framework: Next.js, Build: `pnpm build`, Install: `pnpm install`, Node: `engines.node >=20` 자동 감지.
2. **`TYPESAFE_API_KEY`를 Vercel Production Secret으로 등록 완료.** Preview에는 등록하지 않았다.
3. **MFDS 키는 넣지 말 것** — 런타임에서 쓰지 않는다. 넣어도 해는 없지만 불필요한 secret이다.
4. `pnpm-lock.yaml`이 커밋되어 있으므로 `--frozen-lockfile` 기본 동작으로 설치된다. corepack 버전 이슈가 나면 Vercel의 `packageManager` 필드 존중 여부를 확인할 것.
5. 배포 후 스모크: 목표 설정 → `갈비탕 하나 먹었어` → 새로고침 후 기록 유지.

### 알려진 런타임 특성

- **저장소가 브라우저다.** 기기/브라우저를 바꾸면 기록이 따라가지 않는다. 의도된 MVP 범위다.
- 서버는 상태가 없으므로 인스턴스가 여러 개여도 상관없다.
- 첫 렌더는 `loading` 상태이고 그동안 입력창이 비활성이다 — 하루치를 읽기 전에 삭제/질문을 받으면 빈 목록 기준으로 틀린 답이 나가기 때문이다.

---

## 19. 다음 단계 우선순위 (구현하지 말 것, 순서만)

1. **실제로 며칠 써 보기** — 이 결과가 2번 seed 확장의 입력이 된다
2. **usage-driven 음식 seed 확장** — `unknown`이 반복된 음식부터. 반드시 행을 눈으로 보고 `FOOD_CD` 추가 (→ §7의 함정)
3. **UI polish** — 실사용에서 걸린 것만
4. **추천** — 남은 칼로리 + 부족한 것 정도. 생성형 코칭 금지
5. **사진 입력** — 가장 나중

---
