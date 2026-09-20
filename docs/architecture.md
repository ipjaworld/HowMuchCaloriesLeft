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
1. 로컬 dataset 매칭 + 결정론적 수량 파싱
        ↓ 후보 없음
2. Jev candidate selection (동적 criteria + none 탈출 옵션)
        ↓ none 또는 낮은 confidence
3. LLM fallback — 음식명 + 수량 추출만
        ↓
   추출된 이름을 다시 로컬 dataset에 매칭 → kcal
```

`삶은 계란 두 개` 같은 입력은 1단계에서 끝난다. `아아 한잔에 크림 조금` 같은 입력만 3단계로 간다.

데이터 출처는 식약처 표준데이터 파일을 로컬에 번들하는 방식으로 시작하고, 공공데이터포털 OpenAPI는 동일한 `NutritionResolver` 인터페이스의 다른 구현체로 나중에 추가한다.

## 4. 확신도 정책 (Phase 4)

TypeSafe 공식 권장을 출발점으로 삼되, 동작의 파괴성에 따라 임계값을 달리한다.

| 동작 | 자동 실행 | 확인 후 실행 | 되묻기 |
| --- | --- | --- | --- |
| `ask_status` / `ask_recommendation` (읽기) | ≥ 0.5 | — | < 0.5 |
| `add_food` | ≥ 0.9 | 0.5 ~ 0.9 | < 0.5 |
| `modify_food` | ≥ 0.9 | 0.5 ~ 0.9 | < 0.5 |
| `delete_food` | ≥ 0.95 | 0.7 ~ 0.95 | < 0.7 |

주의: `choice` 답변에는 `confidence`가 있지만 **`noul` 답변에는 없다.** noul이 반환하는 값 자체가 확률이다. 두 종류를 같은 코드 경로에서 섞지 않는다.

정확한 숫자는 `fixtures/korean-inputs.json` 골든셋 실측으로 Phase 4에서 확정한다. 위 값은 시작점일 뿐이다.

## 5. 폴더 구조

```
src/
  app/                  Next.js App Router — 화면과 route handler
  domain/               순수 타입과 계산. 의존성 없음          (Phase 3)
  application/          유스케이스 오케스트레이션, 확신도 정책  (Phase 3~4)
  ai/
    judgment/           Jev 경계 + 한국어 골든셋
      types.ts          intent 어휘 — 질문 criteria와 fixture의 단일 출처
      goldenSet.ts      골든셋 스키마·로더
    nutrition/          NutritionResolver와 구현체들           (Phase 5)
  infrastructure/       repository 구현                        (Phase 3)
  env.ts                환경변수 스키마 (서버 전용)
fixtures/
  korean-inputs.json    한국어 자연어 골든셋 60건
docs/
  architecture.md       이 문서
```
