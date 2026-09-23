# 오늘 얼마 먹어도 돼?

먹은 걸 평소 말하듯 입력하면 기록하고, **오늘 앞으로 얼마나 더 먹을 수 있는지** 바로 보여주는 앱.

```
나: 갈비탕 하나랑 밥 한 공기 먹었어
앱: 기록했어요.
    오늘 1,580 / 2,100 kcal
    520 kcal 남았어요.

나: 아까 밥은 절반 정도 남겼어
앱: 점심 기록을 수정했어요.
    오늘 1,425 / 2,100 kcal
    675 kcal 남았어요.
```

## 핵심 UX

화면은 셋뿐이다. **오늘 상태 · 오늘 먹은 것 · 대화 입력창.**

커뮤니티, 배지, 스트릭, 체중 그래프, 운동 프로그램, 물 섭취 기록은 넣지 않는다. 사용자가 CRUD 폼을 직접 조작하는 대신 자연어로 말하면 앱이 의도를 판단해 기록을 바꾼다. 판단이 애매하면 멋대로 바꾸지 않고 **짧게 되묻는다.**

말투도 짧게 유지한다. 과한 격려나 건강 코칭을 하지 않는다.

## 기술 스택

| | |
| --- | --- |
| Next.js | 16.3.5 (App Router) |
| React | 19.3.0 |
| TypeScript | 5.9.3 (strict) |
| Tailwind CSS | 4.3.3 |
| Zod | 4.6.5 |
| ESLint | 9.39.5 + `eslint-config-next` |
| 패키지 매니저 | pnpm 12.5.1 |
| Node | 20 이상 |
| 판단 | TypeSafe AI — Jev (System One) |

## 실행 방법

```bash
pnpm install
pnpm dev          # http://localhost:3000

pnpm typecheck
pnpm lint
pnpm test
pnpm build

pnpm eval:jev                  # 실제 Jev로 골든셋 60건 측정 (TYPESAFE_API_KEY 필요)
EVAL_JUDGE=mock pnpm eval:jev  # 규칙 기반 fallback 기준선 (키 불필요)
pnpm sync:mfds                 # 식약처에서 데이터셋 재생성 (MFDS 키 필요)
```

`eval:jev`와 `sync:mfds`는 개발용이다. `pnpm test`는 네트워크를 전혀 타지 않는다.

pnpm이 없다면 corepack으로 켠다.

```bash
corepack enable --install-directory ~/.local/bin pnpm
```

## 환경변수

`.env.example`을 `.env.local`로 복사해서 쓴다. 실제 키는 절대 커밋하지 않는다.

| 변수 | 필수 | 용도 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | 아니오 | Jev 판단. **없으면 결정론적 mock으로 동작한다.** |
| `MFDS_FOOD_NUTRITION_API_KEY` | 아니오 | 식약처 영양성분 DB. **`pnpm sync:mfds`에서만 쓴다** — 앱은 커밋된 데이터셋 파일을 읽는다 |
| `MFDS_FOOD_NUTRITION_ENDPOINT` | 아니오 | 위 API 주소. 기본값이 있어 보통 건드릴 일 없다 |
| `ANTHROPIC_API_KEY` | 아니오 | 음식명·수량 파싱 **fallback 전용.** 칼로리 값은 생성하지 않는다. |

전부 서버에서만 쓰인다. `src/env.ts`는 클라이언트에서 import되면 예외를 던진다.

식약처 키는 [data.go.kr 15127578](https://www.data.go.kr/data/15127578/openapi.do)에서 활용신청하면 개발계정은 자동승인된다. **없어도 앱은 돈다** — `data/korean-foods.json`이 커밋되어 있고, 키는 그 파일을 새로 만들 때만 필요하다.

## Jev가 하는 일 / 하지 않는 일

Jev는 ChatGPT 같은 생성형 챗봇의 대체재가 아니다. **문장을 만들지 않고, 타입이 정해진 판단과 확률을 돌려준다.**

**하는 일**

- intent 판단 — `add_food` / `modify_food` / `delete_food` / `ask_status` / `ask_recommendation` / `other`
- 지금 말한 게 실제로 먹은 것인지 (`갈비탕 칼로리 높아?`를 기록으로 저장하면 안 된다)
- 기록을 바꾸기 전에 사용자 확인이 필요한지
- 최근 기록 중 무엇을 가리키는지 (`아까 밥`이 어느 항목인지)

**하지 않는 일**

- 산술 (`2100 - 1580`은 TypeScript가 한다)
- 칼로리 합산
- 음식의 칼로리 값 생성 — 영양정보는 `NutritionResolver`가 **조회**한다
- 사용자에게 보여줄 문장 생성

원칙은 하나다. **AI가 이해하고 판단한다. 코드가 계산하고 변경한다.**

자세한 경계 설계는 [`docs/architecture.md`](docs/architecture.md) 참고.

## 현재 MVP 범위

단일 사용자, 인증 없음, 저장은 브라우저 `localStorage`. 목표 칼로리는 사용자가 숫자로 직접 입력한다. (예시에 나오는 2,100은 **샘플 값일 뿐 권장 섭취량이 아니다.**)

| Phase | 내용 | 상태 |
| --- | --- | --- |
| 0 | 조사 — Jev 문서, 스택, 영양 데이터 후보 | 완료 |
| 1 | 프로젝트 기반, 환경변수 스키마, 한국어 골든셋 | 완료 |
| 2 | UI shell (mock data) | |
| 3 | 도메인 — MealRecord CRUD, 칼로리 계산, 저장소, 테스트 | |
| 4 | Jev 연동 — intent 판단, 확신도 정책, mock fallback | 완료 |
| 4.5 | **Jev 한국어 실측** — 정확도 측정, 임계값 확정, reference 전략 결정 | **완료** |
| 5A | 수량 파서, NutritionResolver, 데이터셋 계약 | 완료 |
| 5B | **식약처 OpenAPI 연결** — client · importer · 번들 데이터셋 | **완료** |
| 6 | 자연어 end-to-end — command를 실제 기록에 연결 | 미착수 |

### 지금 어디까지 되나

**판단은 실측했다.** `jev-1.13.0`으로 골든셋 60건을 돌렸다 — intent **93~95%**, 섭취 판별 **96.7%**, reference **95%**. 확신도 임계값은 그 결과로 확정했고, reference는 **전략 A**(Jev가 고르고, 확신이 낮으면 코드 휴리스틱이 받는다)를 골랐다. 근거와 틀린 케이스 전부는 [`docs/architecture.md`](docs/architecture.md#31-jev-한국어-실측-phase-45)에 있다.

한 번의 판단은 **p50 261ms · 60건에 $0.0027**이다.

**칼로리 데이터가 들어왔다.** 식약처 식품영양성분DB(331,212행)에서 골라 `data/korean-foods.json`으로 번들했다. 앱은 런타임에 API를 호출하지 않는다.

```
갈비탕 한 그릇   → 362 kcal   (670g × 54 kcal/100g)
공기밥 한 공기   → 351 kcal   (210g × 167 kcal/100g)
라면 한 그릇     → 451 kcal   (550g × 82 kcal/100g)
삶은계란 두 개   → unmeasurable ← MFDS에 개당 무게가 없다
아메리카노 한 잔 → unmeasurable ← 잔 용량이 없다
커피 200ml      → 8 kcal       ← 양을 말해주면 바로 계산된다
마라탕          → unknown      ← 데이터셋에 아예 없다
```

`unmeasurable`과 `unknown`은 다르다. 앞은 **음식은 아는데 그 단위의 무게를 모르는 것**이라 사용자가 양을 말해주면 풀리고, 뒤는 그렇지 않다. 앱이 할 말이 다르므로 타입에서 구분한다.

**모르는 건 모른다고 한다.** 이게 버그가 아니라 설계다. 데이터가 1인분 무게를 주지 않으면 그럴듯한 숫자를 만들지 않고 되묻는다.

### 남은 한계

- **음식 14개뿐이다.** `seeds.ts`에 손으로 확인한 `FOOD_CD`만 담았다. 이름 검색은 부분 일치라 `커피`가 커피번(389 kcal/100g)을, `아메리카노`가 인스턴트 분말(200 kcal/100g)을 물어온다 — 그래서 자동으로 늘리지 않는다
- **Phase 6이 남았다.** 판단과 조회는 되지만 `add_candidate` → 실제 기록 저장이 아직 연결되지 않았다. 화면은 여전히 mock 데이터로 돈다
- LLM fallback 파서는 설계만 있고 구현하지 않았다

### 한국어 골든셋

`fixtures/korean-inputs.json`에 추가 / 수정 / 삭제 / 질문 / 추천 / 비섭취 / 모호 7개 범주 **60건**이 들어 있다. 스키마는 `src/ai/judgment/goldenSet.ts`.

Jev는 영어가 주 훈련 언어이고 한국어를 포함한 CJK는 정확도가 낮을 수 있다고 공식 문서에 명시돼 있다. 그래서 모델 버전이나 질문 문구를 바꿀 때마다 이 골든셋으로 회귀 측정한 뒤 반영한다. 기대값은 *모델이 지금 내놓는 답*이 아니라 *맞는 답*이다. 실패하는 케이스는 고장난 fixture가 아니라 알려진 격차다.

## 이후 확장 아이디어

- 서버 DB + 인증 (repository 인터페이스만 교체)
- 데이터셋 항목 확대 (`seeds.ts`에 확인한 `FOOD_CD` 추가)
- 단백질 등 macro 표시 — 식약처 응답에 이미 들어 있다
- 자주 먹는 음식 빠른 재입력

의학적 진단이나 치료를 목적으로 하는 서비스가 아니다.
