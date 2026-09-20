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
pnpm build
```

pnpm이 없다면 corepack으로 켠다.

```bash
corepack enable --install-directory ~/.local/bin pnpm
```

## 환경변수

`.env.example`을 `.env.local`로 복사해서 쓴다. 실제 키는 절대 커밋하지 않는다.

| 변수 | 필수 | 용도 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | 아니오 | Jev 판단. **없으면 결정론적 mock으로 동작한다.** |
| `ANTHROPIC_API_KEY` | 아니오 | 음식명·수량 파싱 **fallback 전용.** 칼로리 값은 생성하지 않는다. |

둘 다 서버에서만 쓰인다. `src/env.ts`는 클라이언트에서 import되면 예외를 던진다.

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
| 4 | Jev 연동 — intent 판단, 확신도 정책, mock fallback | |
| 5 | NutritionResolver — 식약처 데이터, 수량 파싱, LLM fallback | |
| 6 | 자연어 end-to-end | |

### 한국어 골든셋

`fixtures/korean-inputs.json`에 추가 / 수정 / 삭제 / 질문 / 추천 / 비섭취 / 모호 7개 범주 **60건**이 들어 있다. 스키마는 `src/ai/judgment/goldenSet.ts`.

Jev는 영어가 주 훈련 언어이고 한국어를 포함한 CJK는 정확도가 낮을 수 있다고 공식 문서에 명시돼 있다. 그래서 모델 버전이나 질문 문구를 바꿀 때마다 이 골든셋으로 회귀 측정한 뒤 반영한다. 기대값은 *모델이 지금 내놓는 답*이 아니라 *맞는 답*이다. 실패하는 케이스는 고장난 fixture가 아니라 알려진 격차다.

## 이후 확장 아이디어

- 서버 DB + 인증 (repository 인터페이스만 교체)
- 식약처 OpenAPI를 `NutritionResolver`의 두 번째 구현체로 추가
- 단백질 등 macro 표시
- 자주 먹는 음식 빠른 재입력

의학적 진단이나 치료를 목적으로 하는 서비스가 아니다.
