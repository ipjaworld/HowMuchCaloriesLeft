# Codex 인수인계 — 2026-09-27 작업 (v0.3)

> 대상: 이 저장소를 이어서 작업할 AI 에이전트(Codex).
> 이 문서는 **2026-09-27 하루 동안 바뀐 것**만 다룬다. 프로젝트 전체 맥락은 `docs/HANDOFF.md`(v0.2까지)와 `docs/architecture.md`를 먼저 읽을 것.
> 저장소 루트의 `AGENTS.md`도 반드시 읽을 것. 이 프로젝트의 Next.js(16.3.5)는 학습 데이터와 다를 수 있어서, 코드를 쓰기 전에 `node_modules/next/dist/docs/`를 확인해야 한다.

---

## 0. 한눈에 보기

| 항목 | 값 |
| --- | --- |
| 앱 | "오늘 얼마 먹어도 돼?" — 말하듯 음식을 입력하면 남은 칼로리를 보여주는 한국어 웹앱 |
| 스택 | Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · zod · Vitest · pnpm |
| 저장 | 브라우저 `localStorage`만 사용 (서버 DB 없음) |
| AI | TypeSafe **Jev** 한 가지 — 의도·대상 판단만 한다 (§1) |
| 영양 데이터 | 식약처(MFDS) 식품영양성분DB에서 고정한 행 → `data/korean-foods.json` |
| production | https://how-much-calories-left.vercel.app — **`main`에 push하면 Vercel이 자동으로 production 배포** |
| 오늘 시작점 | `4f5df50` (v0.2 배포) |
| 오늘 끝 | `651a4f8` — push와 배포 완료, working tree clean |
| 테스트 | 711개 통과 (시작 시 575개) · `tsc` · `eslint` 모두 통과 |

---

## 1. 절대 원칙 (어기면 이 프로젝트의 존재 이유가 사라짐)

**"AI는 판단하고, 칼로리는 조회하고, 계산은 코드가 한다."**

- **Jev**가 하는 일은 판단뿐이다. 의도(`add_food` / `modify_food` / `delete_food` / `ask_status` / …), 어떤 기존 기록을 가리키는지, 확신도. 결과는 항상 타입이 있는 값이고 문장을 만들지 않는다.
- **칼로리 숫자는 절대 모델이 만들지 않는다.** 숫자의 출처는 셋뿐이다.
  1. MFDS 데이터셋 행
  2. 공개 출처가 있는 1인분 기준(`servingReferences.ts`, 출처 명시, 목록에 `~` 표시)
  3. **사용자가 직접 말한 숫자** (오늘 추가됨, §3-1)
- 모르는 음식은 `unknown`으로 두고 사용자에게 **물어본다.** 그럴듯한 추정값은 이 설계가 막으려는 실패다.
- `calorieSource`에 `"ai_estimate"` 같은 값은 **만들지 않는다.** 논의 끝에 거절된 설계다.
- 문장에서 숫자와 표현을 읽는 일(파싱)은 **정규식 같은 결정적 코드**로만 한다. LLM으로 슬롯을 뽑아내지 않는다.
- 답변 문구는 짧게 사실만 말한다. 칭찬·격려·경고·건강 판정("성공/실패/위험/과식")은 쓰지 않는다. 문구는 모두 `src/components/replyText.ts`·`historyText.ts`에서 코드로 만든다.

## 2. 작업 방식 규칙 (사용자 선호)

- **커밋은 사용자가 요청하거나 승인할 때만.** push는 곧 production 배포라서 더 신중해야 한다.
- 커밋은 **작업 단위로 나누고**, 각 커밋이 단독으로 `tsc` · `eslint` · `vitest`를 통과하게 한다. 오늘은 스테이징한 것만 남기고 나머지를 stash한 상태에서 검사했다.
- 커밋 메시지는 영어, `type: summary` 형식에 본문으로 "왜"를 설명한다. 스타일은 `git log` 참고.
- 사용자는 3000번 포트에 자기 `next dev`를 띄워두는 경우가 많다. **그 프로세스를 죽이지 말 것.** API 확인에는 써도 되지만 브라우저 확인은 따로 띄운 `pnpm build && pnpm start --port 3200` 같은 서버에서 한다. `127.0.0.1:3000`은 dev 서버의 cross-origin 차단 때문에 hydration이 되지 않는다.
- 사용자의 실제 localStorage 데이터는 건드리지 않는다. 브라우저 테스트는 다른 origin(다른 포트)에서 한다.

---

## 3. 오늘 한 작업 (커밋 순서대로)

```
651a4f8 style: show the exchange as messenger bubbles, app in ink and user in white
8415b59 feat: remove a logged food with one tap, and undo it with one more
33b56d8 fix: never ask "which record" twice, and read a bare amount as a correction
ee8bd88 fix: read the count even when the eating verb is typed casually
e8e2b25 feat: understand corrections the way people say them
1061d11 style: show a pointer on everything that acts on a click
5717872 fix: ask for height before weight in the goal calculator
4a96fd0 feat: look back over past days at /history
b06ae15 fix: draw every day boundary in Korean time
f71fea6 feat: add 26 diet and fitness foods with the wording people use for them
c3b5f02 feat: point a goal change in chat at the goal control
49221a3 feat: record calories the user states, and ask for them when a food is unknown
8dd2537 docs: record the v0.2 production deployment
```

### 3-1. 사용자가 말한 칼로리 (`49221a3`)
- 발단: "이건 데이터베이스에 없을 거 같고 한 600kcal 먹었다는"이라고 입력하자 "정보가 없어요"로 끝났다.
- `src/ai/nutrition/statedCalories.ts`: **단위가 붙은 숫자만** 칼로리로 읽는다(`kcal|칼로리|칼|cal`). "간식 한 300"처럼 단위가 없으면 g일 수도 있어서 추측하지 않는다.
- 해당 조각은 조회하지 않고 `calorieSource: "user"`로 말한 값 그대로 저장한다. 데이터셋에 있는 음식이어도 사용자 값이 우선이다.
- 합계 표현("김치찌개랑 밥 합쳐서 800칼로리")은 한 줄로 저장해서 이중 계산을 막는다.
- 음식 이름을 알아볼 수 없으면 `"직접 입력"`으로 저장한다(`cleanFoodLabel`은 두 단어 이하일 때만 이름으로 인정).
- **모르는 음식**은 이제 조용히 빠지지 않고 `provide_calories` 질문("대략 몇 kcal였는지 알려주시면 그대로 적을게요")을 한다. "빼고"·"모르겠어"로 건너뛸 수 있고(`skipped` 상태), 새 문장을 입력하면 질문을 접는다.
- 도메인: `FoodItem.calorieSource?: "dataset" | "user"`(선택 필드라 기존 기록과 호환).

### 3-2. 채팅으로 목표를 바꾸려 할 때 안내 (`c3b5f02`)
- "목표 1800으로 바꿔줘" → "목표는 위의 '목표 수정'에서 바꿀 수 있어요." 채팅은 목표를 **바꾸지 않는다**(사용자 결정).
- `asksToChangeGoal()`은 고정 규칙이다: "목표" + 바꾸는 말 + 먹는 말 없음. Jev에 새 의도를 추가하지 않았다.

### 3-3. 다이어트·헬스 식품 26개 (`f71fea6`, 83 → 109개)
- 다이어트 콘텐츠는 **무엇을 넣을지 고르는 데만** 썼다. kcal은 전부 MFDS 행에서 가져왔다.
- 추가 절차: `MFDS_QUERY="이름" pnpm candidates:mfds`로 후보를 보고 → 사람이 행(`FOOD_CD`)을 골라 `src/ai/nutrition/mfds/seeds.ts`에 기록 → `pnpm sync:mfds`(약 10분, 전체 재생성) → 기존 항목이 바뀌지 않았는지 diff로 확인.
- 띄어쓰기는 매칭할 때 무시되므로 별칭에는 **표현이 다른 것만** 넣는다(예: "닭찌찌살", "무가당 그릭요거트").
- **부분 일치 함정**(테스트로 고정): 그냥 "샐러드"를 별칭으로 넣지 않는다("참치 샐러드" 오인). 보충제 가루에 "쉐이크"를 연결하지 않는다("쉐이크 300ml" = 가루 300g). 오트밀크는 따로 항목으로 넣었다(마른 오트밀 382kcal/100g 오인 방지).
- 넣지 않은 것: 프로틴바, 땅콩버터, 하루견과. 브랜드 행만 있고 값 차이가 크다. 사용자가 포장의 kcal을 말하면 된다.

### 3-4. 하루 경계를 한국 시간으로 고정 (`b06ae15`)
- `src/domain/date.ts`가 순간(시각)을 날짜로 바꾸는 **유일한 곳**이다. `Intl.DateTimeFormat`에 `timeZone: "Asia/Seoul"`을 써서, 기기 시간대와 관계없이 KST 00:00~23:59를 하루로 본다.
- **ISO 문자열을 잘라서 날짜를 만들지 말 것.** 기록 시각은 `toISOString()`(UTC)으로 저장되므로, 00:10 KST는 `…T15:10:00.000Z`다.
- 테스트는 `+09:00` 시각으로 고정했고 `TZ=UTC`, `America/Los_Angeles`, `Asia/Seoul`에서 모두 통과한다.

### 3-5. 지난 기록 `/history` (`4a96fd0`)
- `src/app/history/page.tsx` + `src/components/HistoryScreen.tsx`. Today 오른쪽 위 "지난 기록" 링크로 들어간다.
- 날짜별로 목표, 섭취 합계, 차이, 건수, 또는 "기록 없음"을 보여준다. 누르면 그날 목록(`MealList`, 읽기 전용)이 펼쳐진다.
- **과거 목표 보존은 저장을 추가하지 않고 해결했다.** 목표 저장소는 원래부터 "바꾼 날짜마다 항목 하나"였다. 이전 목표를 이어 쓰는 규칙은 `src/domain/history.ts`의 `effectiveGoal()`로 옮겨서 Today와 히스토리가 같은 함수를 쓴다.
- 합계는 기록에서 매번 계산하고 저장하지 않는다. 저장 형식이 바뀌지 않아서 이전 작업이 필요 없다.
- 히스토리 시작일은 첫 기록일과 첫 목표일 중 빠른 날이다.
- `DayOutcome = "no_record" | "no_goal" | "under" | "exact" | "over"`는 도메인 값이다(나중에 streak·badge에서 재사용하려고). **"목표 범위" 허용 오차는 없다.** 의도적으로 만들지 않았고, 사용자가 정할 제품 결정으로 남겨뒀다.

### 3-6. 계산기 입력 순서 키 → 몸무게 → 나이 (`5717872`)
- 테스터가 몸무게 칸에 키를 입력했다. 몸무게 허용 범위가 30~250kg이라 184도 통과해버렸다.
- `src/components/profileForm.ts`의 `PROFILE_FIELD_ORDER`로 순서를 명시했다. 값은 필드 이름으로 연결되고, 184/92 입력이 184cm/92kg으로 저장되는지 테스트한다.

### 3-7. pointer 커서 (`1061d11`)
- Tailwind v4는 버튼의 기본 `cursor: pointer`를 없앴다. `globals.css`의 `@layer base` 규칙 하나로 활성화된 버튼·`role=button`·선택지 라벨 등에 적용했다.

### 3-8. 자연스러운 수정 문장 (`e8e2b25`)
- 원인: Jev는 수정 의도와 대상을 정확히 잡았다(요거트 1.00). 그런데 문장 파서가 수정 문장 전체를 음식 이름 하나로 읽었다.
- `src/application/correction.ts`: 수정 문장을 추가 기록이 이해하는 짧은 구절로 바꾼다. **API route(`/api/chat`)에서 대상 기록의 이름과 양을 이용해** 조회한다.
  - "떠먹는 요거트를 그릭 요거트로 바꾸고 싶어" → `그릭 요거트 200g` (기존 양 유지)
  - "쌀밥 2공기 말고 1공기" → `쌀밥 1공기` · "아까 사과 두 개였어" → 2개로 다시 계산
  - "아까 700 아니고 550이야" → 550kcal(사용자 값). 숫자 하나만 있으면 `calorieSource: "user"` 기록일 때만 kcal로 본다. 이를 위해 Jev에 보내는 `recentItems`에 `calorieSource`를 넣었다.
- 같은 음식이 여러 번 기록돼 있으면 "사과를 두 번 기록했어요. 어느 기록인가요?"라고 묻는다.
- 확인 문구: "바꿨어요: 떠먹는 요거트 200g → 그릭요거트 200g (172 → 200 kcal)." / "바나나 2개를 지웠어요."

### 3-9. 실사용에서 나온 버그 2건 (`ee8bd88`, `33b56d8`)
1. **"바나나 2개 먹었엉"이 1개로 저장**(조용히 틀린 숫자). 동사 어미 목록 방식을 버리고, 먹·마시·드시로 시작하는 **마지막 단어를 통째로** 뗀다(`stripEatingVerb`).
2. **"어떤 기록을 수정할까요?" 무한 반복.** 기록을 고르면 같은 문장을 다시 보내는데, 음식 이름이 없어서 대상을 또 못 찾았다. 이제 고른 기록은 `/api/chat` 요청의 `chosen: { targetId, intent }`로 전달되고, `decideCommand(judgment, input, chosen)`이 **그대로 따른다**(다시 묻지 않음).
   - 양만 있는 문장("2개 먹었다니까?")은 가장 최근 기록을 고치는 것으로 보고 확인 질문("바나나를 고칠까요?")을 한다.
   - 이미 같은 양이면 "이미 바나나 2개로 기록돼 있어요."라고 답한다.

### 3-10. × 삭제와 되돌리기 (`8415b59`)
- Today 목록 각 줄 끝에 작은 ×(보이는 크기 12px, 누르는 영역 32px, 항상 표시)가 있다. 누르면 바로 삭제하고 응답에 [되돌리기]를 붙인다.
- `restoreFoodItem()`은 원래 기록의 원래 위치로 복구한다. 혼자 있던 음식이어서 기록째 사라졌다면 기록 전체를 원래 문장과 함께 되살린다.
- `MealList`는 `onDeleteItem`을 넘길 때만 ×를 보여준다. 히스토리는 넘기지 않아서 읽기 전용이다.

### 3-11. 메신저 말풍선 (`651a4f8`)
- `src/components/ChatInput.tsx`: **내 말은 오른쪽 흰 말풍선, 앱 응답은 왼쪽 검은 말풍선**(생각 중 점 세 개도 검은 말풍선 안). 사용자가 홍보 목업(좌우 반대)이 아니라 **일반 메신저 배치**를 골랐다.
- 대화 기록은 남기지 않고 **마지막 한 번의 주고받음**만 보여준다. 선택지를 누르면 그 내용이 내 말풍선이 되고, ×로 지우면 내 말풍선 없이 앱 응답만 나온다.
- `ink-faint` 색 토큰은 쓰는 곳이 없어져서 지웠다.

---

## 4. 요청 한 번의 흐름 (수정할 때 어디를 볼지)

```
TodayScreen (client)
  └ buildChatRequest {message, now, dailyGoalCalories, recentItems, chosen?}
      → POST /api/chat (src/app/api/chat/route.ts)
          judge.judge()            ← Jev: 의도·대상·확신도
          decideCommand()          ← src/application/commands.ts (순수 함수, 확신도 정책)
          expand()                 ← 조회: add는 resolveAddParts, modify는 correctionFor→resolveAddParts
      ← { command, judgment }
  └ startAdd / startModify / applyDelete → pendingAdd(질문 상태) → commitAdd / commitModify
  └ 문구: replyText.ts   저장: infrastructure/localStorage*Repository.ts
```

localStorage 키: `hmcl.v1.mealRecords`, `hmcl.v1.dailyGoals`, `hmcl.v1.dietProfile`, `hmcl.v1.onboarding`. 모두 `{ version: 1, … }` 형식이고 읽을 때 zod로 **항목마다** 검사한다(`parseValidEntries`). 새 필드는 **선택 필드로만** 추가할 것.

## 5. 검증 명령

```bash
pnpm exec tsc --noEmit -p .     # .next/types가 오래되면 오류가 날 수 있음 → rm -rf .next/types
pnpm exec eslint .
pnpm exec vitest run            # 711 tests
TZ=UTC pnpm exec vitest run     # 날짜 경계 회귀 확인
pnpm build && pnpm start --port 3200   # 브라우저 확인용 (3000은 사용자 dev 서버)
```

배포 상태는 `gh` CLI가 없으니 GitHub 공개 API로 확인한다:
`curl -s https://api.github.com/repos/ipjaworld/HowMuchCaloriesLeft/commits/<sha>/status`

## 6. 남은 일과 알려진 한계

- `docs/HANDOFF.md`는 아직 v0.2 기준이다. 이 문서 내용을 반영해 v0.3 섹션을 추가해야 한다.
- 히스토리의 "목표 범위" 허용 오차는 없다(제품 결정 대기).
- "바나나 하나 빼줘"(2개 중 하나 줄이기)는 아직 이해하지 못한다(Jev 0.47 → "무슨 말씀인지 모르겠어요").
- 수정 후 양 표시는 사용자 표현 그대로다(예: "사과 두 개"). "2개"로 맞출지는 미정.
- 새 식품 대부분은 1인분 중량이 없어서 "두부 반 모" 같은 표현은 g을 다시 묻는다. 중량을 넣으려면 공개 출처가 있어야 한다.
- 단위 없는 숫자("간식 한 300")는 일부러 kcal로 읽지 않는다.

---

## 7. 🆕 다음 작업: 홍보 홈페이지 목업을 실제 앱에 맞추기

> **이 저장소 밖의 작업이다.** 사용자가 운영하는 개인사업자 홈페이지의 제품 소개 섹션(히어로)에 있는 앱 목업을 고친다. 그 사이트의 저장소·프레임워크는 이 문서가 알지 못하므로, 그쪽 코드 구조를 먼저 확인하고 아래 **시각 명세**만 맞추면 된다.

### 현재 목업 (2026-09-27 캡처 기준)
- 왼쪽: "EVERYDAY NUTRITION UTILITY" / "오늘 얼마 먹어도 돼?" / 소개 문구 / [MVP 사용해보기 ↗] [GitHub ↗]
- 오른쪽: 흰 카드(뒤에 주황색 오프셋 그림자)
  - "오늘 · 9월 24일", 큰 숫자 `1,738`, "kcal 남았어요", 진행 막대
  - 대화: **"나" 라벨 + 밝은 베이지 말풍선이 왼쪽**("갈비탕 하나 먹었어"), **"앱" 라벨 + 검은 말풍선이 오른쪽**("기록했어요. 오늘 362 kcal 먹었어요.")
  - "* 예시 목표 2,100 kcal 기준"

### 바꿀 것 (필수) — 실제 앱(`651a4f8`)과 같게
| | 내 말 (사용자) | 앱 응답 |
| --- | --- | --- |
| 위치 | **오른쪽 정렬** | **왼쪽 정렬** |
| 순서 | 위 (먼저 말함) | 아래 (응답) |
| 배경 | `#ffffff` + 1px 테두리 `#ddd9d1` | `#1b1917` |
| 글자 | `#1b1917` | `#ffffff` |
| 모서리 | 18px, **오른쪽 아래만 6px** (말꼬리) | 18px, **왼쪽 아래만 6px** |
| 최대 너비 | 부모의 80% | 부모의 88% |

공통: 글자 14px(0.875rem), 줄간격 1.625, 안쪽 여백 10px 14px, 두 말풍선 사이 8px, 한국어 줄바꿈은 `word-break: keep-all`.

- "나"/"앱" 라벨: 실제 앱에는 화면에 보이는 라벨이 없다(스크린리더용 "나:"만 있음). 목업에서 라벨을 **없애는 것을 권장**한다. 남기려면 "나"는 오른쪽 말풍선 위에 오른쪽 정렬, "앱"은 왼쪽 말풍선 위에 왼쪽 정렬로 옮긴다.
- 사용자 말풍선을 베이지(`#eeebe4` 계열)에서 **흰색 + 테두리**로 바꾼다. 카드 배경이 흰색이라 테두리가 없으면 말풍선이 보이지 않는다.

### 맞추면 좋은 것 (선택, 정확성)
- 응답 문구: 목표가 있으면 실제 앱은 남은 칼로리까지 말한다. 목업 숫자(목표 2,100, 섭취 362, 남은 1,738)에 맞추면 **"기록했어요. 오늘 362 kcal 먹었어요. 1,738 kcal 남았어요."** 가 정확한 문구다.
- 큰 숫자 옆 단위: 실제 앱은 `1,738` 옆에 `kcal`, 그 아래 줄에 "남았어요"를 둔다. 목업은 "kcal 남았어요"를 한 줄로 쓴다. 맞출지는 사이트 디자인 판단에 맡긴다.
- 주황색 진행 막대와 오프셋 그림자는 홈페이지 브랜드 요소라 그대로 둬도 된다. 참고로 실제 앱의 막대는 `#1b1917`이고, 강조색(`#a4550c`)은 목표를 넘었을 때만 쓴다.

### 완료 기준
- 목업의 대화 영역이 실제 앱 화면(Today 하단)과 좌우·색·순서가 같다.
- 모바일 폭(390px)에서도 말풍선이 넘치지 않고, 가로 스크롤이 생기지 않는다.
- 홈페이지 저장소의 커밋과 배포는 **사용자 승인 후**에 한다(§2).
