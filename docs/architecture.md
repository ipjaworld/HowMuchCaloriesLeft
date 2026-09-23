# 아키텍처

## 1. 책임 경계

```
사용자 자연어
      ↓
Jev              판단한다   — intent, 확신도, 어떤 기록을 가리키는가
      ↓
NutritionResolver 조회한다   — 음식명/양 → 영양정보
      ↓
TypeScript        계산하고 바꾼다 — 합산, 잔량, 상태 변경
```

| 계층 | 하는 일 | **하지 않는 일** |
| --- | --- | --- |
| Jev (System One) | 구조화된 판단, 후보 중 선택, 확신도 | 문장 생성, 산술, 칼로리 추정 |
| NutritionResolver | 음식명·수량 → kcal | 의도 판단, 기록 변경 |
| LLM fallback | 음식명·수량 **파싱만** | **칼로리 값 생성 금지** |
| domain / application | 합산, 잔량, CRUD | AI 호출 |

## 2. 상태 경계 — localStorage와 `/api/chat`

MVP의 도메인 상태는 **브라우저에만** 있다. 서버는 localStorage를 읽을 수 없으므로, 경계를 다음과 같이 못박는다.

```
┌─ Browser ───────────────────────────────────────────────┐
│  localStorage ←→ MealRecordRepository ←→ React state    │  ← 상태의 유일한 소유자
│                                                          │
│  사용자 입력                                              │
└───────────────┬──────────────────────────────────────────┘
                │  POST /api/chat
                │  { message, now, dailyGoalCalories, recentItems[] }   ← 최소 context
                ▼
┌─ Server (route handler) ────────────────────────────────┐
│  secret 보유: TYPESAFE_API_KEY, ANTHROPIC_API_KEY        │
│                                                          │
│  Jev judgment → confidence policy → NutritionResolver    │
│                                                          │
│  stateless. 저장소에 접근하지 않고, 아무것도 변경하지 않는다.  │
└───────────────┬──────────────────────────────────────────┘
                │  { command, reply }                      ← "무엇을 하라"만 반환
                ▼
┌─ Browser ───────────────────────────────────────────────┐
│  command를 repository에 적용 → 재계산 → 렌더              │
└──────────────────────────────────────────────────────────┘
```

### 규칙

1. **서버는 stateless다.** 저장소를 모르고, 세션을 갖지 않는다. 판단에 필요한 것은 전부 요청 본문으로 받는다.
2. **서버는 데이터를 바꾸지 않는다.** `Command`를 반환할 뿐이고, 적용은 클라이언트의 repository가 한다. AI 결과와 데이터 변경 사이에 항상 클라이언트 코드가 한 겹 있다.
3. **최소 context만 보낸다.** 오늘 기록 + 목표 + 기준 시각까지. 과거 전체 이력을 보내지 않는다 (Jev state 상한은 32k 토큰이고, 후보가 많을수록 `choice` 정확도가 떨어진다).
4. **secret은 서버에만 있다.** `src/env.ts`는 클라이언트에서 import되면 throw한다. 클라이언트 번들에 키가 들어갈 경로 자체를 만들지 않는다.
5. **합산은 클라이언트가 한다.** 서버는 새 항목의 kcal 조회 결과만 돌려주고, 오늘 총량과 잔량은 클라이언트의 순수 함수가 계산한다. 서버가 돌려준 합계를 믿지 않는다.
6. **확인이 필요하면 왕복하지 않는다.** 서버가 `clarify` command를 주면 클라이언트가 확인 UI를 띄우고, 사용자가 고른 뒤 그 결과를 클라이언트가 직접 적용한다.

### Command (Phase 3~4에서 확정)

```
add     { items: FoodItem[] }
modify  { targetId, patch }
delete  { targetId }
answer  { reply }                        // 기록 변경 없음 — 질문/추천/비섭취 문장
clarify { question, candidates?: [...] } // 확신도 부족 — 사용자에게 되묻는다
```

### 나중에 서버 DB로 옮길 때

repository가 서버로 이동하고, `/api/chat`이 command를 직접 적용하게 된다. 요청/응답 형태와 위 규칙 1·2를 제외한 나머지는 그대로 유지된다. 그래서 지금 UI 코드는 repository 인터페이스 너머를 절대 들여다보지 않는다.

## 3. 음식 → 칼로리 해석 (Phase 5)

LLM은 **fallback이다.** 기본 경로에서는 호출되지 않는다.

```
1. 로컬 dataset 매칭 + 결정론적 수량 파싱      ← Phase 5A/5B 완료, 실데이터
        ↓ 후보 없음 / 후보 여럿
2. Jev candidate selection (동적 criteria + none 탈출 옵션)
        ↓ none 또는 낮은 confidence
3. LLM fallback — 음식명 + 수량 추출만
        ↓
   추출된 이름을 다시 로컬 dataset에 매칭 → kcal
```

`삶은 계란 두 개` 같은 입력은 1단계에서 끝난다. `아아 한잔에 크림 조금` 같은 입력만 3단계로 간다.

**불변 규칙: 칼로리는 조회하는 것이지 생성하는 것이 아니다.** 데이터셋이 모르는 음식의 답은 `unknown`이고, 그럴듯한 숫자를 만들어내지 않는다.

### `PhraseResolution` 네 상태

"모른다"가 **성격이 다른 두 답**으로 갈리기 때문에 셋이 아니라 넷이다.

```ts
resolved      계산됐다
ambiguous     여러 음식에 걸린다 — 어느 쪽인지 되묻는다
unmeasurable  음식은 알고 칼로리도 아는데, 그 단위의 무게가 데이터에 없다
unknown       데이터셋에 아예 없다
```

| 입력 | 상태 | 사용자에게 할 말 |
| --- | --- | --- |
| `마라탕 먹었어` | `unknown` | "그 음식은 몰라요" — 사용자가 할 수 있는 게 없다 |
| `커피 한잔 마셨어` | `unmeasurable` | "아메리카노는 아는데 한 잔이 몇 ml인지 몰라요" — **한 마디면 풀린다** |
| `커피 200ml 마셨어` | `resolved` | 8 kcal |

둘을 한 상태로 뭉치면 **아는 음식을 모른다고 답하게 되고**, 해결할 수 있는 사람에게 해결책을 숨긴다. 현재 데이터셋에서 `unmeasurable`이 되는 건 삼각김밥·삶은 달걀·아메리카노 셋이다.

`unmeasurable`의 `reason`은 지금 `missing_serving` 하나뿐이다. **낯선 단위는 여기 오지 않는다** — `toGrams`가 그 음식의 기본 1인분으로 대체하고 `estimated`로 표시한다. 숫자가 아예 안 나오는 유일한 경우는 항목에 `servings`가 없을 때다.

### 단위로 후보 좁히기

`밥`은 쌀밥·현미밥·**김밥·비빔밥**에 전부 들어 있어 이름 점수가 같다. 그래서 사용자가 말한 **단위**로 좁힌다.

```
"밥 한 공기"  →  쌀밥(공기) ✓  현미밥(공기) ✓  김밥(줄) ✗  비빔밥(그릇) ✗
              →  ambiguous [쌀밥, 현미밥]   ← 진짜 물어야 할 것만 남는다
```

**추측이 아니라 데이터 제약이다** — `servings`만 본다. 후보를 잃지 않도록 세 가지를 지킨다: 수량을 가정했으면 좁히지 않고, g·ml은 모든 음식에 적용되므로 좁히지 않고, **해당 단위를 가진 후보가 하나도 없으면 전부 유지한다**(낯선 단위는 기본 1인분으로 처리하는 편이 "아무것도 모른다"보다 낫다).

### 식약처 데이터 연결 (Phase 5B) — 완료

**식품의약품안전처_식품영양성분DB** (data.go.kr `15127578`) · 이용허락범위 제한 없음 · 개발계정 일 10,000건.

```
GET https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03
    ?serviceKey=...&pageNo=1&numOfRows=100&type=json&FOOD_NM_KR=갈비탕
→ { header: { resultCode, resultMsg }, body: { totalCount, items: [...] } }
```

실제 응답에서 확인한 것(문서가 아니라 **응답을 보고** 정리):

| 필드 | 값 | 쓰임 |
| --- | --- | --- |
| `FOOD_CD` | `D105-199000000-0001` | 항목 id — 출처 추적의 핵심 |
| `FOOD_NM_KR` | `갈비탕` | 이름 |
| `SERVING_SIZE` | `100g` 또는 `100mL` | **모든 수치의 기준** |
| `AMT_NUM1` ~ `AMT_NUM157` | `"54.00"` | 영양성분. **이름이 없는 번호 컬럼** |
| `Z10500` | `"670.000g"` | 1인분 총 중량 |
| `NUTRI_AMOUNT_SERVING` | `"210g"` | 가공식품 표시 1회 제공량 |
| `DB_GRP_NM` / `DB_CLASS_NM` | `음식`/`품목대표` | 행 선별 |
| `CRT_MTH_NM` | `분석`/`수집`/`산출` | 산출 방식 |

전체 **331,212행**.

#### 위험 1 — 영양소가 번호 컬럼이다

`AMT_NUM1`이 에너지라는 건 **가정**이다. 그래서 믿지 않고 검산한다: 단백질(`AMT_NUM3`)·지방(`AMT_NUM4`)·탄수화물(`AMT_NUM6`)에 Atwater 계수(4/9/4)를 적용해 `AMT_NUM1`과 대조하고, 어긋나면 그 행을 **버린다**.

700행 표본(음식/가공식품/원재료성)에서 네 값이 모두 있는 602행 중 **584행이 15% 이내** 일치했다. 컬럼 순서가 바뀌면 조용히 틀린 칼로리가 들어가는 대신 import가 시끄럽게 실패한다.

#### 위험 2 — 이름 검색이 위험하다

`FOOD_NM_KR`은 **부분 일치**다. 실제로 확인한 함정:

| 검색 | 돌아오는 것 | 진짜 |
| --- | --- | --- |
| `커피` | 커피번 **389 kcal/100g** | — |
| `아메리카노` (정확 일치) | 인스턴트 **분말** 200 kcal/100g | 내린 커피 **4 kcal/100g** |
| `바나나` (정확 일치) | 바나나맛 **과자** 454 kcal/100g | 생바나나 ~80 |
| `갈비탕` | 품목대표만 **6행**, 27~89 kcal/100g | — |

그래서 **이름으로 고르지 않는다.** `seeds.ts`가 손으로 확인한 `FOOD_CD`를 직접 지정하고, 행이 하나로 좁혀지지 않으면 건너뛰고 보고한다.

#### 적재 방식 — API → 정규화 파일 → 기존 resolver

```
pnpm sync:mfds  (오프라인, 개발자만)
   MFDS API → selectRow(FOOD_CD) → toFoodEntry → data/korean-foods.json
                                                        │ 커밋됨
앱 런타임 (네트워크 호출 없음)                              ▼
   koreanFoods.ts → parseFoodEntries → createLocalDatasetResolver
```

**live query를 쓰지 않는 이유**: 331,212행은 번들할 수 없고, 요청 시점에 행을 고르면 위의 함정을 그대로 밟는다. 호출당 ~300ms · 일 10,000건 제한인 반면 로컬 조회는 0ms이고, `localDatasetResolver`와 그 테스트가 이미 이 형태를 소비한다. 테스트 스위트는 네트워크를 전혀 타지 않는다.

#### 1인분 정보는 있을 때만 쓴다

`servings`의 그램 수는 **언제나 행이 명시한 값**이다(`Z10500` 또는 `NUTRI_AMOUNT_SERVING`). 단위 이름(공기·그릇·잔)만 `seeds.ts`가 정하는 언어적 정보이고, **크기는 절대 정하지 않는다.** 두 필드가 기준값(100g/100mL)과 같으면 "1인분 정보 없음"으로 읽는다.

현재 14개 항목 중 **11개에 1인분 정보가 있고 3개는 없다.** 없는 것은 `unmeasurable`이 된다.

| 항목 | 이유 |
| --- | --- |
| 삶은 달걀 | MFDS에 **개당 무게가 없다.** `계란 두 개` → unknown |
| 아메리카노 | **잔 용량이 없다.** `한 잔` → unknown |
| 삼각김밥 | 행의 200g이 한 개가 아니다 — 단위를 달지 않았다 |

**억지로 채우지 않는다.** 모르는 건 모른다고 답하고 앱이 되묻는다.

#### ⚠️ 100mL 기준 행은 아직 실데이터로 검증되지 않았다

`SERVING_SIZE`는 `100g` 아니면 `100mL`인데, **현재 14개 항목은 전부 `100g`**이다. importer는 `100mL` 행도 받아들이고 밀도 1 g/mL 가정을 `source` 문자열에 남기게 되어 있지만, 그 경로를 실제로 타본 적이 없다.

**음료 seed(두유·우유·주스 등)를 추가할 때 반드시 실제 응답으로 검증할 것.** 특히 `Z10500`이 mL로 오는데 `servings.grams`에는 그램으로 들어간다는 점을 확인해야 한다.

### 데이터셋 계약 (`dataset.ts`)

투입될 데이터가 맞춰야 할 형태. 로드 시 zod로 검증하고, 깨진 행은 버리되 나머지는 살린다.

```ts
{
  version: 1,
  source: { name, retrievedAt, license },   // 출처 추적 가능해야 함
  entries: [{
    id, name,
    aliases?,                  // 아아 → 아이스 아메리카노, 공기밥 → 흰쌀밥
    caloriesPer100g,           // 식약처가 발행하는 단위
    servings?: [{ unit, grams }],  // 한 공기 = 210 g. 첫 항목이 기본값
    source,
  }]
}
```

`servings`가 없는 항목은 무게를 계산할 수 없으므로 **`unmeasurable`**로 처리된다 — 추정하지 않되, `unknown`과는 구분한다.

## 3.1 Jev 한국어 실측 (Phase 4.5)

> 2026-09-23 · 모델 `jev-1.13.0` · `fixtures/korean-inputs.json` 60건 · `pnpm eval:jev`

| 항목 | 정확도 | 비고 |
| --- | --- | --- |
| intent | **93.3~95.0%** (56~57/60) | 재실행 간 1건 정도 흔들림 |
| actual_consumption | **96.7%** (58/60) | |
| reference_target | **95.0%** (19/20) | confidence 분리도가 가장 좋음 |
| needs_clarification | **35.0% → 73.3%** | 임계값 0.5→0.85 조정 후 |

카테고리별 intent: add·modify·delete·question·recommendation **100%**, ambiguous 85.7%, not_consumption 62.5%.

비용과 지연: 60건 호출에 input 65,108 토큰 / **$0.0027** (output 무료), latency p50 **261ms** · p90 **305ms**, 동시성 5에서 전체 3.6초. 실사용 한 번의 판단이 300ms 아래라 왕복 한 번으로 충분하다.

### 잘한 것

- **먹은 것과 먹지 않은 것을 가른다.** `갈비탕 칼로리 높은 편이야?` 0.04 · `제육 먹어도 될까?` 0.05 — 기록으로 새지 않는다.
- **표면형이 다른 reference를 푼다.** `아까 커피 먹었다고 한 거 취소` → 아메리카노 항목 (conf 0.99), `커피는 안 마셨음` → 아메리카노 (0.77). **규칙 기반 mock은 둘 다 놓친다.** 이게 Jev를 쓰는 이유 그 자체다.
- **reference confidence가 정직하다.** 맞은 19건은 전부 ≥ 0.74, 틀린 1건은 0.29. 임계값 0.5가 둘을 깨끗이 가른다.

### 알려진 약점

| 케이스 | 실제 | 영향 |
| --- | --- | --- |
| `편의점 도시락 괜찮아?` `다이어트 할 때 야식 어때?` `내일 갈비탕 먹을까 생각중` | `other` 기대 → `ask_recommendation` (conf 0.83~0.93) | **없음.** 둘 다 읽기 전용 `answer`라 기록을 건드리지 않는다. 확신 있게 틀리므로 임계값으로 못 잡고, 골든셋 경계 자체가 모호하다 |
| `방금 넣은 거 취소해줘` | reference `null` (conf 0.29) | 코드 휴리스틱이 받아 처리 (→ 아래 전략 A) |
| `라면` 같은 맨 음식명 | consumption 0.45 → 기록 안 됨 | 임계값을 내리면 `아침에 먹은 거 칼로리 얼마야?`(0.64)가 새므로 그대로 둔다 |
| `needs_clarification` 전반 | 분포가 겹친다 | 아래 참조 |

### needs_clarification은 이 넷 중 가장 약하다

임계값 0.5에서 60건 중 44건에 "확인이 필요하다"고 답했다. `점심에 갈비탕 먹음` 같은 평범한 보고까지 되물었다.

분포가 거의 완전히 겹친다 — **정말 물어야 할 케이스 0.34~0.94, 물을 필요 없는 케이스 0.19~0.93.** 어떤 임계값도 둘을 가르지 못한다. 0.85는 "덜 나쁜 쪽"으로 고른 운용점이지 깨끗한 분리점이 아니다.

두 가지는 이 값에 기대지 않는다.

1. **읽기 전용 intent는 아예 참조하지 않는다.** 질문·추천은 기록을 바꾸지 않으니 물을 일이 없다. (`decideCommand`가 이미 그렇게 되어 있다.)
2. **모호함과 파괴성은 다른 질문이다.** `점심 기록 지워줘`(0.34) `오늘 기록 다 지워줘`(0.38)에서 Jev는 **옳다** — 가리키는 대상이 분명하다. 그런데도 확인을 받아야 하는 이유는 되돌리기 어려워서지 모호해서가 아니다. 그건 noul이 아니라 코드가 판단한다: **대상이 하나로 좁혀지지 않은 삭제는 언제나 되묻는다.**

### mock과의 차이

mock은 intent 100% / reference 90%다. **이 점수를 Jev의 근거로 읽으면 안 된다** — mock 규칙은 바로 그 60건을 보고 작성했다. 의미 있는 건 *불일치*다.

- reference에서 **Jev가 이긴다**: 동의어(커피↔아메리카노) 2건을 Jev만 맞힌다. mock이 맞히는 1건은 `방금` 지시 표현인데, 이건 규칙이 더 잘하는 영역이라 코드 fallback으로 흡수했다.
- intent에서 mock이 3건 앞서는 건 전부 위 `other`/`ask_recommendation` 경계 건이고, 동작 차이가 없다.

## 3.2 reference 전략 — **A 채택 (+ 저확신 코드 fallback)**

| | 전략 | 판정 |
| --- | --- | --- |
| **A** | Jev reference 유지 | ✅ **채택** |
| B | 코드 휴리스틱 우선 | ❌ Jev(95%)가 mock(90%)보다 낫고, 동의어는 규칙으로 못 푼다 |
| C | reference 전면 코드 이동 | ❌ 위와 같은 이유 |

근거는 두 숫자다. **Jev 95% vs mock 90%**, 그리고 **맞은 건 전부 ≥0.74 / 틀린 건 0.29**. 뒤쪽이 더 중요하다 — Jev가 자기가 틀렸을 때를 스스로 알려준다.

그래서 이렇게 조합한다.

```
Jev가 고른다
   ├─ confidence ≥ 0.5 → 그대로 쓴다
   └─ confidence < 0.5 → 버리고 코드 휴리스틱에 묻는다   (referenceHeuristic.ts)
                            ├─ 이름/최근성으로 찾으면 → 쓴다
                            └─ 못 찾으면 → 사용자에게 되묻는다
```

둘의 강점이 정확히 어긋나 있어서 겹치지 않는다. Jev는 **동의어**를 풀고(커피→아메리카노), 규칙은 **음식명이 아예 없는 지시 표현**을 푼다(`방금 넣은 거`). 골든셋 20건에서 이 조합은 20/20이다.

`referenceHeuristic.ts`는 원래 `mockJudge` 안에 있던 함수다. 이제 mock 전용이 아니라 실제 경로의 일부라 별도 모듈로 승격했다.

## 4. 확신도 정책 — 실측 확정 (Phase 4.5)

동작의 파괴성에 따라 임계값을 달리한다. 아래는 **실측 후 확정된 값**이고, 각 숫자의 근거는 `confidence.ts` 주석에 케이스와 함께 남아 있다.

| 동작 | 자동 실행 | 확인 후 실행 | 되묻기 | 변경 |
| --- | --- | --- | --- | --- |
| `ask_status` / `ask_recommendation` / `other` (읽기) | ≥ 0.5 | — | < 0.5 | confirm 0.3 → **0.5** |
| `add_food` | ≥ 0.9 | 0.5 ~ 0.9 | < 0.5 | 유지 |
| `modify_food` | ≥ **0.85** | 0.5 ~ 0.85 | < 0.5 | auto 0.9 → **0.85** |
| `delete_food` | ≥ 0.95 | 0.7 ~ 0.95 | < 0.7 | 유지 |

noul: `actualConsumption ≥ 0.5` (유지), `clarificationNeeded ≥ **0.85**` (0.5에서 상향). reference 하한 0.5 (유지).

**바꾼 이유**

- **modify 0.9 → 0.85.** 11건 예측 전부 정답, 최저 0.65. 0.9에서는 이 앱의 대표 예시인 `아까 밥 반만 먹었어`(0.87) · `아까 밥은 절반 정도 남겼어`(0.89)가 매번 확인을 받아야 했다. 수정은 화면에 보이고 되돌릴 수 있어 위험이 제한적이다.
- **읽기 전용 confirm 0.3 → 0.5.** 코드의 읽기 분기는 confirm 밴드를 참조하지 않아, 실효 하한이 문서에 적힌 0.5가 아니라 0.3이었다. 밴드를 비워 문서와 코드를 일치시켰다. `많이 먹었어`(ask_status 0.30)가 엉뚱한 숫자를 답하는 대신 되묻게 된다.
- **clarification 0.5 → 0.85.** 골든셋에서 불필요한 되묻기 18건 → 8건, 실행 12건 → 22건. 꼭 물어야 할 9건 중 7건은 그대로 잡는다. 0.90으로 더 올리면 되묻기는 2건 더 줄지만 놓치는 확인이 1→3건으로 늘어난다 — **모호한 문장을 조용히 실행하는 쪽이 한 번 더 묻는 쪽보다 나쁘다.**

**delete는 일부러 두었다.** 9건 예측에 오탐 0건이었지만, 오탐이 0이라는 건 낮춰도 안전하다는 증거가 아니라 아직 시험되지 않았다는 뜻이다. `커피는 안 마셨음`(0.73) · `갈비탕 잘못 입력했어 지워줘`(0.88)는 계속 확인을 받는다. 탭 한 번이 더 싼 실수다.

주의: `choice` 답변에는 `confidence`가 있지만 **`noul` 답변에는 없다.** noul이 반환하는 값 자체가 확률이다. 두 종류를 같은 코드 경로에서 섞지 않는다.

**표본은 60건 한 번**이다. delete·other는 예측 건수가 한 자리라 수렴한 추정치가 아니라 근거 있는 운용점이다. 같은 픽스처 두 번 실행에서 confidence가 최대 0.03 흔들렸으므로, 0.01 단위로 맞춘 임계값은 노이즈를 맞추는 것이다.

## 4.1 add_food end-to-end (Phase 6A)

자연어 한 문장이 실제 `MealRecord`가 되기까지.

```
"갈비탕 하나랑 밥 한 공기 먹었어"
        │
        ▼  POST /api/chat
   Jev judgment → decideCommand → add_candidate{needsConfirmation}
        │
        ▼  서버에서 조회 (여기서만 async)
   parseFoodPhrases → NutritionResolver → AddPart[]
        │
        ▼  { type:"add", sourceText, parts, needsConfirmation }
   ─────────────── 서버는 여기까지. 아무것도 바꾸지 않는다 ───────────────
        │
        ▼  브라우저
   PendingAdd  ──질문이 남았으면─→ 되묻기 → 답변 반영 → 다시 검사
        │ 전부 해결됨
        ▼
   addMealRecord (Phase 3 함수 그대로) → repository → 재조회 → 합계 재계산
```

**서버가 보내는 건 문장이 아니라 타입이다.** `AddPart`는 음식 구문 하나당 하나이고, 상태가 `resolved`/`ambiguous`/`unmeasurable`/`unknown` 넷 중 하나다. 클라이언트가 문장을 해석해서 행동을 정하는 경로는 없다.

### PendingInteraction

```ts
type PendingAdd = {
  sourceText: string;      // 원문. 그대로 기록에 남는다
  now: string;             // 브라우저 시계
  parts: AddPart[];        // 답이 들어올 때마다 갱신
  needsConfirmation: boolean;
};

type PendingQuestion =
  | { type: "confirm_add";      names: string[] }
  | { type: "choose_food";      partIndex; phraseName; candidates }
  | { type: "provide_quantity"; partIndex; phraseName; entries; reason };
```

두 가지가 설계의 핵심이다.

1. **parts가 곧 상태다.** 질문 큐를 따로 두지 않고 `nextQuestion()`이 parts에서 파생한다. 서로 맞춰야 하는 구조가 둘이면 언젠가 어긋난다.
2. **한 문장은 한 기록이다.** 두 음식이 든 문장에서 아는 것만 먼저 저장하고 나머지를 묻지 않는다. 전부 해결될 때까지 기다렸다가 `MealRecord` 하나를 쓴다. 그래야 취소했을 때 되돌릴 게 남지 않는다.

**클라이언트 상태다.** 서버 세션도 localStorage도 아니다. 새로고침하면 진행 중이던 질문은 사라지고, 그 비용은 문장 하나를 다시 치는 것뿐이다. 반쯤 끝난 질문은 데이터가 아니다.

### 다음 입력은 열린 질문이 가져간다

`provide_quantity`가 열려 있으면 다음 메시지는 **Jev를 거치지 않고** `/api/resolve`로 간다. `200ml`을 독립 문장으로 판단시키면 `other`가 나오고, 왕복 한 번을 써서 "도와줄 수 없다"는 답을 받게 된다.

`/api/resolve`는 음식이 이미 정해진 상태에서 양만 묻는 엔드포인트다. 조회는 여전히 서버에 있고, 이 핸들러도 stateless다.

`quantity.ts`에는 그래서 함수가 둘이다. `parseTrailingQuantity`는 문장 속에서 수량을 찾고 **수량이 전부인 입력을 거부한다** — 문장 안에서 `하나`만 있으면 그건 음식 이름이다. `parseAmountOnly`는 반대로 그것만 받는다. 같은 패턴, 호출자가 이미 아는 것에 대한 반대 가정.

### add_food에서는 clarification Noul을 쓰지 않는다

Phase 4.5 실측에서 이 noul은 한국어에서 넷 중 가장 약했다(분포가 거의 완전히 겹침). 반면 "어떤 음식을 얼마나"는 resolver가 **데이터로 확정적으로** 답한다.

| add_food 상황 | 판단 주체 |
| --- | --- |
| resolved | 질문 없음 → 저장 |
| ambiguous | resolver → 후보 선택 질문 |
| unmeasurable | resolver → 수량 질문 |
| unknown | resolver → 저장하지 않음 |
| intent 자체가 애매 | **intent confidence** (noul 아님) |

`ClarifyReason`에서 `unclear_food`를 지웠다. 만들어낼 주체가 없어졌기 때문이다. modify/delete에서는 noul을 계속 쓴다 — 어떤 *기록*을 가리키는지는 데이터셋이 모른다.

### 중간 확신도는 버리지 않고 물어본다

intent confidence가 confirm 구간(add 0.5~0.9)이면 **조회는 그대로 하고** 확인만 덧붙인다. 실측에서 `갈비탕 하나랑 밥 한 공기 먹었어`가 0.65로 나왔는데, 여기서 문장을 버리고 "기록할까요?"만 물으면 "네"를 받아도 실행할 게 남지 않는다. 조회 결과를 들고 물으므로 왕복도 늘지 않고, 질문이 무엇을 기록할지 이름을 댈 수 있다 — `갈비탕과 밥을 기록할까요?`

### 아직 아닌 것

- 추천은 문구만 있다
- mealType을 추론하지 않는다. 시계로 점심을 맞히는 규칙은 아무도 요구하지 않았다
- 모르는 음식에 사용자가 직접 kcal를 넣는 경로는 만들지 않았다 — 수동 CRUD가 생기고 "조회한다" 원칙이 흐려진다

## 4.2 modify / delete (Phase 6B)

### 건너야 했던 틈 — item과 record

Jev는 **FoodItem**을 가리킨다. 사람이 그렇게 말하기 때문이다("아까 먹은 갈비탕"). 저장소는 **MealRecord** 단위이고, 한 문장이 한 기록이므로 record 하나에 item이 여럿일 수 있다. 그래서 모든 편집은 먼저 *그 item이 어느 record에 있는지* 찾아야 한다.

```
삭제:  record에 item이 하나뿐  → deleteMealRecord(record)
       다른 item이 남음        → updateMealRecord(record, { items: 나머지 })
수정:  해당 item만 교체        → updateMealRecord(record, { items: 교체본 })
```

**새 CRUD는 만들지 않았다.** `updateMealRecord` / `deleteMealRecord`는 Phase 3부터 있던 것이고, `editFood.ts`는 둘 중 무엇을 부를지만 정한다. 수정해도 item의 `id`와 record의 `sourceText`는 유지된다 — 원래 한 말은 기록이지 정정이 덮어쓸 대상이 아니다.

### 삭제는 스스로 동점을 깨지 않는다

되돌리기 어려운데 사용자가 눈치채지 못할 수 있는 유일한 동작이므로, **지목이 갈리면 코드가 되묻는다.**

실측에서 발견한 실제 사고: 쌀밥(351)과 김밥(322)이 있는 날 `밥 지워줘` 하면 **묻지 않고 쌀밥을 지웠다.** "밥"은 둘 다에 들어 있고 29 kcal가 다르다.

```
delete_food + 문장이 가리키는 item이 둘 이상 + 그것들이 서로 구별됨
  → 언제나 "어떤 기록을 취소할까요?"
```

모델이 골랐든 코드 휴리스틱이 골랐든 **상관없이** 적용한다. 확신도 문제가 아니라 삭제가 해도 되는 일의 문제다. 다만 이름도 칼로리도 같은 항목끼리는 어느 쪽을 지워도 결과가 같으므로 묻지 않는다 — 사용자가 답할 수 없는 질문이다.

수정에는 적용하지 않는다. `아까 밥`은 대개 최근 것을 뜻하고, 수정은 화면에 보이며 되돌릴 수 있다.

### 수정은 add 파이프라인을 그대로 쓴다

평행 구조를 만들지 않았다. 정정도 문장이므로 `parseFoodPhrases` → `NutritionResolver` → `AddPart[]` → `PendingAdd`를 똑같이 지난다. `PendingAdd`에 `target`이 붙어 있으면 마지막에 record를 만드는 대신 item을 교체할 뿐이다.

그 위에 얹은 것은 딱 둘이다.

1. **`preferTargetFood`** — `아까 밥 반만 먹었어`에서 "밥"은 네 음식에 걸리지만 고치려는 항목이 이미 쌀밥이므로 물을 게 없다. 후보 중 대상과 같은 음식이 있으면 거기로 확정한다.
2. **`namesASubstitution`** — `말고 / 아니고 / 아니라`가 있으면 사용자가 *다른 음식으로 바꾸겠다*는 뜻이므로 1번을 적용하지 않고 `무엇으로 바꿀까요?`로 되묻는다. 문법 셋뿐인 고정 목록이고, **무엇을 저장할지가 아니라 물을지 말지만 정한다.**

### 읽지 못하는 정정은 되묻는다

`foodPhrases`는 add 문법(`X 하나 먹었어`)에 맞춰 만든 것이라 정정 문법을 다 읽지 못한다. `갈비탕 반 그릇만 먹었어`는 문장 전체가 이름이 되고 1인분으로 가정되어, **이미 저장된 값이 그대로 다시 나온다.**

그래서 `isSameAs`로 "바뀐 게 없음"을 감지하고 `고쳤어요`라고 말하는 대신 **양을 묻는다.** 파서를 무리하게 늘리는 대신, Phase 6A가 이미 가진 질문을 재사용한다. 대상을 칩으로 고른 경우도 같은 자리로 들어온다.

수량 후속 입력은 `/api/resolve`가 처리하며, **음식을 이름으로 찾는다.** 저장된 `name`이 곧 데이터셋의 정식 이름이고 이름은 데이터셋에서 유일하므로(seeds 테스트가 고정), add 경로와 modify 경로가 같은 한 가지 방법을 쓴다.

### 중간 확신도

| | confirm 구간(0.5~0.95)에서 |
| --- | --- |
| add · modify | **조회를 마친 뒤** 확인을 묻는다 — "네"에 적용할 것이 남아 있어야 한다 |
| delete | 조회할 것이 없으므로 그냥 묻는다 |


## 5. 폴더 구조

```
src/
  app/                  Next.js App Router — 화면과 route handler
    api/chat/           판단 + add 조회
    api/resolve/        수량 후속 입력 전용 (Jev 거치지 않음)   (Phase 6A)
  domain/               순수 타입과 계산. 의존성 없음          (Phase 3)
  application/          유스케이스 오케스트레이션, 확신도 정책  (Phase 3~4)
  ai/
    judgment/           Jev 경계 + 한국어 골든셋
      types.ts          intent 어휘 — 질문 criteria와 fixture의 단일 출처
      questions.ts      Jev 질문 정의 (영문 instructions/criteria)
      jevJudge.ts       TypeSafe 연동  ·  mockJudge.ts  규칙 기반 fallback
      confidence.ts     임계값 단일 출처 (실측 확정)
      referenceHeuristic.ts  코드 기반 reference 해석 (저확신 fallback)
      goldenSet.ts      골든셋 스키마·로더
  application/          mealRecords · dailyGoal · commands
                        · addFood      문장 → AddPart[]        (Phase 6A)
                        · pendingAdd   여러 턴에 걸친 대화 상태  (Phase 6A)
                        · editFood     item → record 찾아 수정/삭제 (Phase 6B)
  ai/
    nutrition/          음식 → 칼로리
      quantity.ts       한국어 수량 파서 (하나/한 공기/반/200ml)
      foodPhrases.ts    문장 → 음식 구문 분해
      dataset.ts        데이터셋 스키마 + 이름 매칭
      localDatasetResolver.ts   NutritionResolver 로컬 구현
      koreanFoods.ts    번들 데이터셋 로드 + resolver 인스턴스
      mfds/             식약처 OpenAPI 경계          (Phase 5B)
        client.ts       실제 응답 형태 · 페이징 · 키 마스킹
        importer.ts     행 → FoodEntry · 에너지 검산 · 행 선별
        seeds.ts        어떤 FOOD_CD를 담을지 (숫자 없음)
      types.ts          FoodEntry · NutritionResolver 포트
  infrastructure/       repository 구현                        (Phase 3)
  env.ts                환경변수 스키마 (서버 전용)
data/
  korean-foods.json     식약처에서 생성한 번들 데이터셋 (pnpm sync:mfds)
fixtures/
  korean-inputs.json    한국어 자연어 골든셋 60건
  mfds-sample.json      실제 식약처 응답 원본 (importer 테스트용)
docs/
  architecture.md       이 문서
```
