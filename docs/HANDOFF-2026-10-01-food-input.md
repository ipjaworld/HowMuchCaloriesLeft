# HANDOFF — 음식 입력 해석 (2026-10-02 244-food production checkpoint)

> 상태: **244-food production checkpoint.** production은 `ed52a24`(244-food v1, 고편차 정책 포함)이고, **8A 후보 필터가 켜져 있다(`FOOD_CANDIDATE_FILTER=on`).** 다음 세션은 이 파일부터 읽는다. 과정이 아니라 지금 사실과 다음 할 일만 적는다.
>
> **로컬에는 고편차 안내 문구 수정(`b677f21`)이 커밋돼 있고 아직 push하지 않았다 — 아래 "244-food v1 coverage"의 "production smoke"와 "현재 상태" 참고. 다음 할 일: 그 push 승인을 받는 것뿐이다.** 파서 규칙 추가 금지, same-food·similar-food 판단 문제는 범위 밖 — 아래 "남은 문제" 참고.

## food-input production checkpoint (2026-10-01)
- **배포**: `main` push `86d11df..5a066fb` → Vercel production 배포 성공. 필터 off 상태의 production smoke(아래 "push 전 smoke test" 2~6, 9) 전부 통과: 김밥 한 줄 322 · 라면+커피 한 기록 · 비빔밥 밥 반 남김 → 반 그릇 320 · 양 질문 중 "김밥 먹었어" → 새 문장 · 떡볶이+튀김 반만 → 확인 → 300 → 1,688−259+130+300=1,859 · add 응답 `candidateFilter` `{"status":"off"}`.
- **8A 활성화**: 2026-10-01 21:56 KST(12:56 UTC). Vercel **Production** env에 `FOOD_CANDIDATE_FILTER=on` 추가 후 `vercel redeploy --target production`(코드 변경 없음). `TYPESAFE_API_KEY`는 production에 이미 있었다. `FOOD_CANDIDATE_TIMEOUT_MS`는 미설정(기본 1500). 다른 env는 건드리지 않았다.
- **8A on production smoke** (빈 기록, https://how-much-calories-left.vercel.app, 응답 전부 200):

| 문장 | command | `candidateFilter` | 결과 |
|---|---|---|---|
| 팀원들이랑 회식에서 삼겹살 먹었어 | add | applied · asked 1 · dropped `["팀원들"]` | 질문 없이 삼겹살구이 1인분 934 |
| 친구랑 김밥 먹었어 | add | no_questions | 김밥 1줄 322 |
| 김밥 먹으려다가 그냥 굶었어 | clarify | (add 아님 → 필드 없음) | 기록 없음, "무슨 말씀인지…" |
| 빵 터졌네 | ignore | (필드 없음) | 기록 없음, kcal 질문 없음 |
| 회의 끝나고 밥 먹었어 | add | applied · asked 1 · dropped `[]` | kcal 질문 유지(파서 경계) |
| 떡볶이 먹으려다 참고 샐러드 먹었어 | add | applied · asked 1 · dropped `[]` | "참고 샐러드" kcal 질문 유지(파서 경계) |

  fallback 0. resolved 음식이 빠진 경우 0. 브라우저에서 잰 `/api/chat` 왕복은 378~657ms(첫 요청만 1,056ms, cold start). off 상태의 같은 측정값은 없다.
- **rollback**: Vercel Production env에서 `FOOD_CANDIDATE_FILTER`를 제거(`vercel env rm FOOD_CANDIDATE_FILTER production`)하거나 `off`로 바꾼 뒤 **redeploy**. env만 바꿔서는 적용되지 않는다. 확인은 add 응답의 `candidateFilter`가 `{"status":"off"}`인지.
- **known issues (이 checkpoint에서 그대로 둠)**: same-food add/modify/delete 흔들림 · 파서 경계 7건 · 김치 dataset(맨 김치 항목 없음) · 한 구절 두 음식 · 동사 없는 나열을 문장 guard가 막는 3건. 상세는 "남은 9건", "확인된 UX 문제".
- production smoke는 실제 사용 브라우저의 localStorage에 기록을 남긴다. 테스트 전 `hmcl.v1.mealRecords`를 백업하고 끝나면 되돌린다(이번 두 차례 모두 되돌림).

## 117-food production checkpoint (2026-10-01)
- **dataset 109 → 117** (`de78322`, production 배포됨). 조회 → 사람이 행 검토 → `seeds.ts`에 FOOD_CD pin → `pnpm sync:mfds` 순서 그대로. 기존 109개 항목은 값 변화 없음.

| 음식 | FOOD_CD | kcal/100g | serving | 1 serving |
|---|---|---|---|---|
| 참치김밥 | D101-007450000-0001 | 174 | 1줄 250g | 435 |
| 치즈김밥 | D101-007490000-0001 | 177 | 1줄 270g | 478 |
| 잡채 | D110-492000000-0001 | 146 | 1인분 200g | 292 |
| 불고기덮밥 | D101-010240000-0001 | 182 | 1그릇 400g | 728 |
| 해물파전 | D109-441110000-0001 | 171 | 1인분 150g | 257 |
| 유부초밥 | D101-042410000-0001 | 194 | 1인분 200g | 388 |
| 깍두기 | D115-665000000-0001 | 33 | 1인분 50g | 17 |
| 감자탕 | D106-260000000-0001 | 71 | 1그릇 530g | 376 |

- 감자탕 530g은 MFDS의 1인분이지 특정 식당의 한 그릇이 아니다. 다른 탕류처럼 추정(~)으로 표시된다. 맨 "파전"·"초밥"·"덮밥"은 이 항목들로 좁혀지지 않는다.
- **검증**: test 905 · typecheck · lint · build. `eval:food-coverage` 163/191 · 159/179, silent wrong/drop/nothing_found 0/0/0, 불필요한 질문 30/21 (전과 동일), 필요한 질문 76 → 72. 새로 실패한 case 없음.
- **말뭉치 기대값 변경 4건** (unknown → 자기 항목 resolved): `trap-01` 감자탕 · `trap-13` 참치김밥 · `trap-14` 치즈김밥 · `unkmix-03` 감자탕에 공기밥. baseline은 이 4건과 `blind-21`(맨 "밥" 후보 9 → 13개, 판정은 그대로 질문)만 달라졌다.
- **production smoke** (`FOOD_CANDIDATE_FILTER=on`, 빈 기록, 응답 전부 200, 394~936ms):

| 문장 | `candidateFilter` | 확인 질문 | 최종 기록 |
|---|---|---|---|
| 참치김밥 먹었어 | no_questions | 없음 | 참치김밥 1줄 ~435 |
| 치즈김밥 먹었어 (참치김밥 기록 후) | no_questions | 있음(add 0.68) → 네 | 치즈김밥 1줄 ~478 |
| 감자탕 먹었어 | no_questions | 없음 | 감자탕 1그릇 ~376 |
| 불고기덮밥 먹었어 | no_questions | 없음 | 불고기덮밥 1그릇 ~728 |
| 팀원들이랑 회식에서 불고기덮밥 먹었어 | applied · asked 1 · dropped `["팀원들"]` | 없음 | 불고기덮밥 1그릇 ~728 |

  kcal·serving은 로컬과 동일. resolved 음식이 필터로 빠진 경우 0, silent wrong/drop 0. 테스트 기록은 되돌렸다.
- **known issue — similar-food confirmation**: 이름이 비슷한 음식이 이미 기록돼 있으면 Jev의 add 확신이 떨어져 "…을 기록할까요?"가 한 번 나온다(참치김밥 → 치즈김밥 0.68~0.73, 감자 → 감자탕 0.83~0.84). "네" 후 기록은 정확하다. same-food 흔들림과 같은 계열이고, 이름이 겹치는 음식을 늘릴수록 늘어난다. 범위 밖으로 둠.
- **rollback**: `git revert de78322` → `main` push(= production 재배포). dataset·seeds·말뭉치·baseline·테스트가 한 커밋에 있어 함께 돌아간다. 8A 필터와는 독립이다.
- 이때 보류한 7개 중 잡채밥·순대볶음·감자전은 아래 120-food checkpoint에서 들어갔다.

## 120-food production checkpoint (2026-10-01)
- **dataset 117 → 120** (`8bce96c`, production 배포됨). 절차는 같다(조회 → 행 검토 → FOOD_CD pin → sync). 기존 117개 항목은 값 변화 없음.

| 음식 | FOOD_CD | kcal/100g | serving | 1 serving |
|---|---|---|---|---|
| 잡채밥 | D101-033000000-0001 | 150 | 1그릇 550g | 825 |
| 순대볶음 | D310-483000000-0004 | 146 | 1인분 400g | 584 |
| 감자전 | D109-408000000-0001 | 133 | 1인분 200g | 266 |

- 감자전 200g이 한 장인지 한 접시인지는 행에 없다. 단위는 인분이고 "감자전 한 장"은 "장 단위 무게는 몰라서, g이나 인분으로 알려주세요"라고 묻는다. 백순대는 별도 행(196 kcal/100g, 1인분 없음)이라 alias로 넣지 않았고 unknown으로 남는다.
- **검증**: test 913 · typecheck · lint · build. `eval:food-coverage` 163/191 · 159/179, silent wrong/drop/nothing_found 0/0/0, 불필요한 질문 30/21 (전과 동일), 필요한 질문 72 → 70. 새로 실패한 case 없음.
- **말뭉치 기대값 변경 2건** (unknown → 자기 항목 resolved): `trap-03` 감자전 · `trap-11` 순대볶음. baseline은 이 2건과 `blind-21`(맨 "밥" 후보에 잡채밥 추가, 판정은 그대로 질문)만 달라졌다.
- **matcher 변화**: 맨 "전"이 unknown → 해물파전|감자전 중 묻는 질문으로 바뀌었다(좁히지 않음). "잡채"·"순대"·"감자"·"감자탕"은 그대로 자기 항목. "김치"·"튀김"·"파전"은 변화 없음.
- **production smoke** (`FOOD_CANDIDATE_FILTER=on` 유지, 빈 기록에서 순서대로, 응답 전부 200, 358~995ms):

| 문장 | `candidateFilter` | 확인 질문 | 결과 |
|---|---|---|---|
| 잡채 먹었어 | no_questions | 없음 | 잡채 1인분 ~292 |
| 잡채밥 먹었어 (잡채 기록 후) | no_questions | 있음(add 0.77) → 네 | 잡채밥 1그릇 ~825 |
| 순대 먹었어 | no_questions | 없음 | 순대 1인분 ~411 |
| 순대볶음 먹었어 (순대 기록 후) | no_questions | 있음(add 0.83) → 네 | 순대볶음 1인분 ~584 |
| 백순대 먹었어 | applied · asked 1 · dropped `[]` | 없음 | unknown, kcal을 물음 |
| 감자 먹었어 | no_questions | 없음 | 감자 1개 ~105 |
| 감자전 먹었어 (감자 기록 후) | no_questions | 없음(add 0.96) | 감자전 1인분 ~266 |
| 전 먹었어 | applied · asked 1 · dropped `[]` | 있음(add 0.63) → 네 | "어떤 전인가요?" 해물파전/감자전, 자동 확정 없음 |

  저장된 기록 6건의 음식·양·kcal 모두 정확. resolved 음식이 필터로 빠진 경우 0, silent wrong/drop 0. 테스트 기록은 되돌렸다.
- **known issue — similar-food confirmation**: 이번 batch에서 잡채 → 잡채밥(0.70~0.77), 순대 → 순대볶음(0.83)에서 확인이 나왔고, 감자 → 감자전(0.96~0.97)은 나오지 않았다. "네" 후 기록은 정확하다. 범위 밖.
- **rollback**: `git revert 8bce96c` → `main` push(= production 재배포). 117-food 상태로 돌아간다. 8A 필터와는 독립이다.
- **보류 중**: 두부김치(돼지고기 포함 여부를 행이 말하지 않음) · 감자튀김(1인분 150g이 MFDS 외식 행 80~130g보다 큼) · 김치전(맨 "김치" 모호성 3 → 4개로 악화) · 계란말이(1인분 없음, 매번 g을 물음).

## 244-food v1 coverage — **production 배포됨** (2026-10-02)
`main` push `8bce96c..ed52a24` → Vercel production 배포 성공. env 변경 없음.

- **정책 변경**: 음식 identity가 분명하면 식약처 행의 값으로 **바로 기록**하고, 재료·양에 따라 차이가 큰 음식은 `variance: "high"`로 표시해 기록 뒤에 안내한다("…은 재료와 양에 따라 칼로리 차이가 클 수 있어요. 다르면 칼로리를 고쳐 말해주세요." — production의 문구. 로컬 `b677f21`에서 바뀜, 아래 "production smoke" 참고). 질문하지 않고, 기록을 막지 않는다. 숫자는 여전히 pin한 행의 것이고 flag는 분류일 뿐이다.
- **데이터 모델(최소 변경)**: `FoodEntry.variance?: "high"`(seed → importer → dataset) · `FoodItem.calorieVariance?: "high"`(저장됨, 선택 필드) · 고편차 항목은 항상 `caloriesEstimated`(~). `describeAdded`가 안내를 덧붙인다. 사용자가 kcal을 말하면 그 값이 이기고 flag는 붙지 않는다.
- **dataset 120 → 244** (+124). 기존 120개 값 변화 없음(부대찌개·닭갈비·닭가슴살 샐러드·채소 샐러드에 `variance`만 추가).
- **고편차 27개**: 마라탕 576 · 샤브샤브 258 · 훠궈 558 · 치킨 903 · 양념치킨 552 · 피자 548 · 찜닭 273 · 곱창전골 528 · 곱창 276 · 갈비찜 495 · 아귀찜 168 · 해물찜 400 · 스테이크 388 · 초밥 608 · 라멘 588 · 돈코츠라멘 686 · 미소라멘 623 · 소유라멘 504 · 참치 샐러드 227 · 돼지국밥 912 · 소갈비구이 723 · 탕수육 520 · 도넛 297 (1 serving kcal) + 기존 부대찌개 · 닭갈비 · 닭가슴살 샐러드 · 채소 샐러드.
- **1인분을 다른 행에서 빌린 것**(`servingReferences.ts`, typical): 마라탕 873g(마라탕 간편조리세트 행) · 훠궈 600g(샤브샤브_소고기 행) · 찜닭 300g(닭볶음탕 행; 자기 행의 1,500g은 한 상 분량) · 라멘 4종 700g(우동_일식 행) · 탕수육 200g(탕수육_새우 행) · 배추김치 50g(깍두기 행) · 카푸치노 355mL(카페 음료 행). 배추김치·카푸치노를 빼면 모두 고편차 표시가 붙는다(테스트로 강제).
- **일반 추가 97개**: 국·탕·찌개·전골 13(닭볶음탕, 곰탕, 닭곰탕, 알탕, 해물탕, 수제비, 청국장찌개, 동태찌개, 콩비지찌개, 버섯·두부·소고기전골, 참치김치찌개) · 국밥·국 7(콩나물·소고기·굴국밥, 만두국, 떡만두국, 북어국, 어묵탕) · 밥·죽 20(볶음밥 4종, 덮밥 5종, 회덮밥, 육회비빔밥, 돌솥비빔밥, 콩나물밥, 보리밥, 짬뽕밥, 잡탕밥, 죽 4종) · 김밥 4 · 면 4(우동, 볶음우동, 콩국수, 오일 스파게티) · 고기·볶음·구이 15(곱창볶음, 돼지갈비찜, 오징어·낙지·주꾸미볶음, 떡갈비, 육회, 장어구이, 함박스테이크, 안심스테이크, 치즈돈가스, 훈제오리, 닭발, 마파두부, 유산슬, 양장피, 월남쌈) · 반찬·전 11(두부조림, 멸치볶음, 콩자반, 시금치나물, 콩나물무침, 어묵볶음, 감자조림, 부추전, 호박전, 동그랑땡, 배추김치) · 만두 2 · 샐러드 2 · 빵·간식 9(핫도그, 약과, 소보로빵, 모닝빵, 단팥빵, 츄러스, 머핀, 베이글, 카스텔라) · 과일·견과·주스 11(망고, 파인애플, 멜론, 체리, 자몽, 단감, 자두, 땅콩, 오렌지·사과·포도주스 — 1회량 없음, g/ml을 묻는다) · 카푸치노.
- **안전장치 추가 1건**(resolver): 한 글자 일반명(빵, 회)이 여러 음식에 걸렸는데 그중 양을 셀 수 있는 것이 하나뿐이면 **확정하지 않고 unknown**으로 묻는다. 없으면 "빵 2조각" → 식빵, "회 1인분" → 육회로 조용히 기록됐다. 파서 규칙은 추가하지 않았고 matcher는 느슨해지지 않았다.
- **검증**: test 953 · typecheck · lint · build. `eval:food-coverage` 162/191 · 158/179, silent wrong/drop/nothing_found **0/0/0**, 불필요한 질문 31/22, 필요한 질문 70 → 59, multi-food 32 → 33/37. `eval:food-judgment`(1회): 8A off 167/191 → on **178/191**, 불필요 22 → 10, wrong/drop 0, 나빠진 case 0, fallback 0, runChat p50 203ms / p90 249ms.
- **정확이 163 → 162인 이유**: `review-01`("치킨 배달시켜서 동생이랑")이 이제 "치킨을 놓침"으로 세어진다(전에는 치킨이 없어 unknown이 정답이었다) −1 · `unk-10` "소고기 200g"이 unknown 대신 소고기 요리 5개 중 고르라는 질문이 됨 −1 · `blind-27` "라면에 김치"가 맞게 됨 +1.
- **말뭉치 기대값 변경 21건**: unknown → resolved 9(unk-01·03·09, unkmix-01·02·04·07, blind-07·26의 해당 음식) · unknown → 양 질문 6(trap-05·23 주스, unk-02·qty-13 치킨 마리, unk-12·unkmix-09 망고) · unknown → 후보 질문 2(homo-pos-02 죽, homo-pos-05 빵) · blind-27 김치 → 배추김치 · review-01 치킨 → resolved(놓침으로 집계) · homo-pos-03 회는 unknown 유지(사유만 갱신). baseline 변경 27건 = 이 21건 + 후보 목록만 늘어난 6건(샐러드 5개, 밥 공기 4개, 파스타 3개, 맨 "밥").
- **브라우저(로컬, 필터 on)**: 고편차 8개(마라탕, 샤브샤브, 치킨, 피자, 참치 샐러드, 초밥, 탕수육, 양념치킨) 바로 기록 + 안내 · 일반 7개(닭볶음탕, 새우볶음밥, 우동, 콩나물국밥, 핫도그 두 개, 라면에 김치) 안내 없이 기록 · "마라탕은 800kcal였어"/"치킨 600kcal로 고쳐줘" → 정정됨 · trap: 튀김·회·빵 2조각·치킨버거 unknown, 치킨 한 마리 → "마리 단위 무게는 몰라서…" · 팀원들이랑 회식에서 탕수육 → 팀원들만 제거. 저장 15건 모두 정확.
- **새로 늘어난 질문/확인**: 샤브샤브(마라탕 기록 후, add 0.88 확인) · "피자 먹으려다가 그냥 굶었어"(피자 기록 후 delete 0.76 "취소할까요?") — same/similar-food 계열. 맨 "소고기"·"참치"·"갈비"·"장어"·"오징어"·"낙지"·"감"은 이제 여러 요리 중 고르라고 묻는다(전에는 unknown). 맨 "밥" 후보는 40개(화면에는 5개).
- **아직 unknown**: 마라샹궈 · 포케 · 타코 · 술 · 케이크 · 아이스크림 · 시리얼 · 떡류 · 튀김류 · 치킨버거 등 버거 변형 · 컵라면·비빔면 · 브랜드 제품. 보류 그대로: 두부김치 · 감자튀김 · 김치전 · 계란말이. **콩자반은 들어갔지만 "콩자반 먹었어"는 못 읽는다**(파서가 끝의 "반"을 수량으로 읽음, "콩조림"은 됨).
- **rollback**: `git revert 8fb8441` → `main` push(= production 재배포). 120-food 상태로 돌아간다. 8A 필터와는 독립이다.
- **production smoke** (`FOOD_CANDIDATE_FILTER=on` 유지, 빈 기록에서 순서대로, `/api/chat` 17회 전부 200, 353~625ms):

| 문장 | `candidateFilter` | 확인 질문 | 결과 |
|---|---|---|---|
| 마라탕 먹었어 | no_questions | 없음 | 마라탕 1그릇 ~576 + 안내 |
| 샤브샤브 먹었어 | no_questions | 없음(add 0.90) | 샤브샤브 1인분 ~258 + 안내 |
| 치킨 먹었어 | no_questions | 없음 | 치킨 1인분 ~903 + 안내 |
| 피자 먹었어 | no_questions | 없음 | 피자 1인분 ~548 + 안내 |
| 초밥 먹었어 | no_questions | 없음 | 초밥 1인분 ~608 + 안내 |
| 라멘 먹었어 | no_questions | 없음 | 라멘 1그릇 ~588 + 안내 |
| 닭볶음탕 먹었어 | no_questions | 없음 | 닭볶음탕 1인분 ~333, 안내 없음 |
| 새우볶음밥 먹었어 | no_questions | 없음 | 새우볶음밥 1그릇 ~636, 안내 없음 |
| 우동 먹었어 | no_questions | 없음 | 우동 1그릇 ~420, 안내 없음 |
| 콩나물국밥 먹었어 | no_questions | 없음 | 콩나물국밥 1그릇 ~406, 안내 없음 |
| 탕수육 먹었어 | no_questions | 없음 | 탕수육 1인분 ~520 + 안내(고편차 음식) |
| 치킨 한 마리 먹었어 (치킨 기록 후) | applied · asked 1 · dropped `[]` | 있음(add 0.66) → 네 | "마리 단위 무게는 몰라서, g이나 인분으로 알려주세요", 기록 없음 |
| 빵 2조각 먹었어 | applied · asked 1 · dropped `[]` | 없음 | unknown, kcal을 물음(식빵으로 확정 안 됨) |
| 회 1인분 먹었어 | applied · asked 1 · dropped `[]` | — | unknown, kcal을 물음(육회로 확정 안 됨) |
| 라면에 김치 먹었어 (라멘 기록 후) | no_questions | 있음(add 0.82) → 네 | 라면 1그릇 ~451 + 배추김치 1인분 ~19, 한 기록 |
| **마라탕은 800kcal였어** (마라탕 기록 후) | — | 없음(add 0.97) | **정정이 아니라 새 기록 "마라탕 800"이 추가됨. 576도 그대로 남아 이중 집계** |
| 치킨 600kcal로 고쳐줘 | (modify) | 없음(modify 1.00) | 치킨 903 → 600 정정, 합계 일치 |

  resolved 음식이 필터로 빠진 경우 0, generic/trap이 특정 음식으로 확정된 경우 0, API error 0. 테스트 기록은 되돌렸다(`mealRecords` 백업 → 복구, 문자열 일치 확인).
- **production smoke 이슈 — "마라탕은 800kcal였어"가 add로 오인됨**: 같은 음식이 이미 기록된 상태에서 Jev가 add 0.97로 판정해 확인 없이 두 번째 기록을 만들었다. 응답은 "기록했어요"라 보이는 실패지만, 당시 안내 문구("다르면 칼로리를 고쳐 말해주세요")가 바로 이 표현을 유도했다. 로컬 smoke에서는 같은 문장이 정정으로 읽혔었다(당시 기록이 더 적었다. 원인은 확인하지 않음). **same-food add/modify 흔들림 계열로 보고 244-food production은 유지한다(rollback 안 함).** intent·파서·same-food 구조는 고치지 않는다.
- **UX 안내 보완 (`b677f21`, 로컬 커밋, 미배포)**: 안내 문구만 명시적 modify 표현으로 바꿨다 → `…은 재료와 양에 따라 칼로리 차이가 클 수 있어요. 다르면 "마라탕 800kcal로 고쳐줘"처럼 말해주세요.` 음식명은 방금 기록한 고편차 음식(여럿이면 첫 번째)이다. `replyText.ts`의 `highVarianceHint`(+test)만 바뀌었다. 검증: test 954 · typecheck · lint · build. 브라우저(로컬, 빈 기록, 필터 off): 마라탕 먹었어 → ~576 + 새 안내 · "마라탕 800kcal로 고쳐줘" → modify 1.00, "바꿨어요: … (576 → 800 kcal)" · 기록 1건만 남음.

### 현재 상태 (2026-10-02 — 244-food production, 안내 문구 수정은 push 승인 대기)
- production: **244-food** (`ed52a24`), `FOOD_CANDIDATE_FILTER=on`. 안내 문구는 옛 문구("다르면 칼로리를 고쳐 말해주세요").
- local `main`: origin/main보다 앞선 커밋에 `b677f21`(안내 문구 수정)과 이 문서 갱신 커밋이 있다. working tree clean. **push 금지 상태 — 사용자 승인 대기.**
- **배포 전 최종 gate (`8fb8441` 코드)**: dataset 244 · test 953 · typecheck/lint/build 통과 · `eval:food-coverage` 162/191 · 158/179 · silent wrong/drop/nothing_found 0/0/0 · 필요한 질문 59 · 불필요한 질문 31/22 · multi-food 33/37. `eval:food-judgment`(`8fb8441`에서 1회): 8A off 167/191 → on 178/191 · 불필요 22 → 10 · wrong/drop 0 · 나빠진 case 0 · fallback 0.
- `b677f21` 이후: test 954 · typecheck/lint/build 통과. `eval:food-coverage`·`eval:food-judgment`는 다시 돌리지 않았다(응답 문구만 바뀜).

### 제품 결정 4건 — v1에서 채택 (2026-10-02)
네 건 모두 현재 상태(`8fb8441`)를 그대로 채택했다. 코드·seed·serving reference 변경 없음, sync 재실행 없음.

1. **마라탕**: 576 kcal / 873g 그대로 채택. 873g은 마라탕 간편조리세트 행(D306-278000000-0001)의 중량을 빌린 값이라 high-variance 대표값 중 근거가 가장 약하지만, high-variance 대표값으로 유지한다. 추가 근거 탐색은 v1 이후.
2. **찌개 200g**: v1에서는 현재 MFDS serving 그대로 유지한다. 청국장찌개(94) · 동태찌개(88)는 이미 production에 있는 김치찌개(90) · 된장찌개(92) · 순두부찌개(70)와 같은 200g 기준이므로 이 둘만 따로 고치지 않는다. 100g당 값은 오류가 아니고 MFDS의 1인분이 작은 것이다. 샤브샤브(258) · 아귀찜(168)도 그대로(고편차 안내 있음). 찌개 serving 정책 개선은 v1 이후 별도 이슈.
3. **브랜드 음식**: "교촌 치킨"처럼 브랜드 + dataset의 일반 음식명이면 지금처럼 일반 대표값(치킨 903)으로 기록하고 high-variance 안내를 붙인다. 브랜드 목록·전용 파서 규칙은 v1에서 추가하지 않는다.
4. **샐러드 high-variance**: 닭가슴살 샐러드 · 채소 샐러드 · 참치 샐러드의 flag를 유지한다(부대찌개 · 닭갈비도 그대로). 안내는 기록할 때마다 붙는다. 반복 안내 UX는 실제 사용 후 별도 개선.

### v1 이후 이슈
- **찌개 serving 재검토**: MFDS 200g 1인분이 식당 뚝배기보다 작다(찌개 5종 전체에 해당).
- **high-variance 안내 빈도 개선**: 지금은 같은 음식도 기록할 때마다 안내한다.
- **same/similar-food confirmation**: 같은·비슷한 음식이 이미 기록돼 있을 때 Jev의 add/modify/delete 흔들림과 확인 질문. "마라탕은 800kcal였어"가 add로 읽혀 중복 기록되는 것도 여기 속한다(안내 문구로 우회했을 뿐 판단은 그대로다).
- **브랜드 세분화 여부**: 브랜드별 값을 둘지, 일반 대표값으로 계속 갈지.

### 다음 세션 순서
1. 이 문서 읽기
2. `git status` / `git log` 확인 (위 "현재 상태"와 같은지)
3. 안내 문구 수정(`b677f21`)의 push 승인 확인 — push는 사용자 승인 후에만. `main` push = production 배포.
4. 배포하면 production smoke: 마라탕 먹었어 → 새 안내 문구 → "마라탕 800kcal로 고쳐줘" → 576 → 800 정정, 기록 1건. smoke 전에 `mealRecords` 백업, 끝나면 복구.
5. 그 사이 코드가 바뀌었다면 전체 gate부터 다시: `pnpm test && pnpm typecheck && pnpm lint && pnpm build` · `pnpm eval:food-coverage` · `pnpm eval:food-judgment`. seed·serving reference를 바꾸면 `pnpm sync:mfds` 필요(단독으로 약 10분, 다른 MFDS 조회와 동시에 돌리지 말 것).

## 제품 목표
평소 말하듯 입력하면 최대한 알아서 기록한다. **틀린 값을 조용히 저장하거나, 먹은 음식을 조용히 빠뜨리지 않는다.** 정보가 정말 부족할 때만 짧게 묻는다.

## 역할 경계 (채택)
| 담당 | 하는 일 |
|---|---|
| Code | 음식 후보 추출(원문 그대로), 수량 파싱, 닫힌 부정 표지, 계산, 저장 |
| Jev | 실제로 먹었는가, add/modify가 섞인 문장인가 같은 의미 판단 |
| Dataset | 음식 정체성과 kcal 근거 |
| UI | 필요한 확인만 짧게 |

## 품질 기준
silent wrong = 0 · **silent drop = 0** · nothing_found = 0 목표 · 불필요한 질문 최소화 · 필요한 질문만 남김 · `unknown` 허용 · **튜닝에 쓴 말뭉치와 blind 점수는 따로 보고**

## M2-final baseline (`pnpm eval:food-coverage`, 192건 / 날짜 1건 분모 제외)
| | parser only | Jev guard 가정 |
|---|---|---|
| 정확 | 163/191 (85.3%) | 159/179 (88.8%) |
| silent wrong / silent drop / nothing_found | 0 / 0 / 0 | 0 / 0 / 0 |
| 필요한 질문 / 불필요한 질문 | 76 / **30** | 76 / **21** |

태그별: `b2_round1` 35/36 · `b2_blind` 21/28 · `b2_review` 7/19. baseline 파일: `fixtures/food-input-coverage.baseline.json` (`pnpm test`가 이 상태에 고정됨. 바꾸려면 `FOOD_COVERAGE_UPDATE=1 pnpm eval:food-coverage` 후 diff 검토).

## 파서에서 유지하는 것
- 수량 뒤 "만" (반 그릇만)
- `dataset.ts` B1 경계 매칭(구절 끝 음식만, 복합어 차단, 동음이의어 사과/아아 등) · 일반명→특정 음식 단일 후보 차단(소고기≠우둔살)
- 먹는 동사 기준 절 분리 (먹고/먹었는데/먹었지만/문장 중간 종결형) · 먹는 동사 정의는 `EATING_STEMS` 한 곳
- 닫힌 부정 표지: 안/못+먹고, 먹으려다, 먹으려고 했는데, 먹고 싶었는데, 말고, 대신, 먹고 싶다/먹을까
- 수량만 있는 절 → 앞 음식 하나의 수량 정정 · 같은 문장 뒤 절의 명시 수량이 이김(`lastSayWins`)
- 남긴 양: 계산 가능하면 뺄셈, 아니면 `partly_left`(양을 물음, 저장 안 함)

## 제거·확장 중단
- 제거: `NON_EATING_PREDICATE`(문장 섭취 여부는 Jev 몫), `dropNarrative`(먹은 음식을 조용히 지웠음), `dataset.ts`의 `HOW_IT_CAME_WORDS`
- **더 늘리지 않음**: `PEOPLE` / `ACTIVITIES` / `TIMES` 목록. **파서 규칙 추가 금지.**

## 확인된 UX 문제
1. ~~양 질문이 다음 입력을 무조건 답으로 소비한다~~ → **해결 (A)**.
2. **같은 음식이 오늘 이미 있으면 Jev가 add/modify/delete를 헷갈린다.** 튀김이 빠지던 silent drop은 **해결 (Phase 1)**. 판단 흔들림 자체는 남았다: 떡볶이 기록 + "떡볶이 먹으려다 참고 샐러드 먹었어" → clarify, 김밥 기록 + "김밥 먹으려다가 그냥 굶었어" → delete 0.71(확인 거침).
3. `partly_left` 브라우저 확인 완료 (빈 날): 밥은 반 남김 → 질문 → "반 그릇" 기록 320kcal · 조금 남김 → 질문 · 라면 반은 남김 → 질문 없이 반 · 김밥이랑 라면 조금 남김 → 두 음식 차례로 질문(임의 선택 없음, 문구 반복은 장황).

## A. 양 질문 수정 — 완료, 고정 (2026-10-01)
`readAmountAnswer`(`quantity.ts`)가 "음식명 없는 순수한 양 답변인가"만 본다. 끝의 요/이요/예요, 정도/쯤, 문장부호를 떼고 `parseAmountOnly`. null이면 `TodayScreen`이 새 문장으로 넘긴다(kcal 질문과 같은 규칙). "몰라" 류는 질문 유지. `/api/resolve`도 같은 함수를 쓴다. 브라우저 확인 4건 통과: 반 그릇이요 → 비빔밥 반 그릇 320 · 양 질문 중 "김밥 먹었어" → 라면 버리고 김밥 기록 · 몰라 → 질문 유지 · 200ml 정도요 → 라면 200ml. **"라면 반" 같은 음식명+양 답변은 의도적으로 지원하지 않는다.**

## Phase 8 측정 결과 (2026-10-01, `pnpm eval:food-judgment`, jev-1.13.0, 3회 실행)
production 코드·Jev 질문·`decideCommand`는 바꾸지 않았다. `scripts/evalFoodJudgment.eval.ts`만 추가.

**TypeSafe 문서**: 한 요청에 질문 수 제한 없음, 질문끼리 서로의 답을 못 봄(병렬·독립). **추출 기능은 없다** — 코드가 준 후보 중 선택만 한다. 즉 파서가 후보, Jev가 판단이라는 현재 분업이 문서가 권하는 형태 그대로다.

**8A — 후보별 "실제로 먹었는가"** (part 236개 / 먹은 part 215개, 후보당 noul 2개: eaten, is-food)
| | 정확 | silent wrong / drop / nothing_found | 불필요한 질문 |
|---|---|---|---|
| parser only | 163/191 | 0 / 0 / 0 | 30 |
| 문장 guard **실측** (production 그대로) | 168~169/191 | 0 / 0 / 2~3 | 21 |
| + 질문 part만 p(eaten)<0.3이면 버림 | **179~180/191** | **0 / 0** / 2~3 | **9** |

- 태그별(질문만 거름): round1 36/36 · **blind 26~27/28 (불필요 5→1)** · review 12/19 (13→6). 질문 문구는 첫 실행 전에 한 번 쓰고 고치지 않았다.
- 분리가 깨끗하다: 질문이 될 먹은 part 최저 0.52~0.59("밤 몇 개"), 안 먹은 part 최고 0.16~0.18. 임계값 0.1~0.5 어디서든 결과 동일. 기록(resolved) part까지 거르면 t≥0.3에서 silent drop 1이 생긴다(바나나 0.29) → **질문만 거르고 기록은 건드리지 않는 쪽**.
- 남은 불필요 질문 9건은 전부 **파서 경계 문제**다(음식이 구절 안에 있는데 잡다한 말이 붙어 unknown: "참고 샐러드", "회의 끝나고 밥", "아메리카노 한 잔 더", "김치찌개 먹는 중"). Jev는 이것들을 먹었다고 맞게 답하므로 필터로는 못 없앤다.
- 문장 guard 실측: `jev_may_guard` 12건 모두 실제로 멈춤(가정 확인). 대신 **먹은 문장 2~3건을 막는다**: "커피 한 잔이랑 바나나 하나"(consumption 0.44~0.46), "점심은 김밥, 저녁은 라면"(0.36~0.39), "밤 몇 개 먹었어". 동사 없는 나열이 약하다. 지금 production에서도 그대로 일어나는 일이다.
- **후보 질문은 production 요청과 따로 보내야 한다.** 1회차에 같은 요청에 넣었더니 공유 state(`food_candidates`) 때문에 안 먹은 문장의 add 확신이 올라갔다("김밥 먹으려다가 그냥 굶었어" 0.22→0.66, "빵 터졌네" 0.41→0.75), decideCommand 결과 4/187 변화. 별도 병렬 요청으로 바꾼 2·3회차가 위 수치다.
- 비용/latency (병렬 두 요청): 문장당 input ≈1357 tok ≈ **$0.000057** (production 단독 $0.000032), p50 ≈210ms / p90 ≈240ms (단독 ≈200/230ms).

**8B — 같은 문장, 기록 맥락만 바꿈** (각 3회, 결과 3회 모두 동일)
| 문장 | 빈 기록 | 같은 음식 기록됨 | 다른 음식 기록됨 |
|---|---|---|---|
| 떡볶이 먹으려다 참고 샐러드 먹었어 | add 0.99 | add 0.37 / modify 0.30 → **clarify(무슨 말씀인지)** | add 0.93 |
| 떡볶이랑 튀김 먹었는데 떡볶이는 반만 | add 0.99 | **modify 0.79 → 확인 후 modify, 파서 후보 2개 → `commitModify`가 parts[0]만 저장해 튀김 누락** | add 0.99 |
| 비빔밥 먹었는데 조금 남겼어 | add 0.99 | modify 0.81 → 확인 후 modify | add 0.92 |
| 떡볶이 말고 샐러드 먹었어 (대조) | add 0.95 | modify 0.66 → clarify(어느 기록) | add 0.66 → 확인 후 add |
| 아까 떡볶이 반만 먹었어 (대조) | add 1.00 | modify 0.91 → modify | add 0.99 |
| 떡볶이 먹었어 (대조) | add 0.99 | add 0.91 | add 1.00 |

- 기록이 없거나 다른 음식이면 add/modify 판단은 정확하다. 흔들리는 건 **같은 음식이 이미 있을 때**뿐이다.
- 튀김 누락은 이제 판단 쪽까지 재현됐다(3/3): 확인을 누르면 먹은 음식이 조용히 빠진다 = **현재 production의 silent drop 경로**.

## Phase 1 — 정정+추가 섞인 문장의 silent drop 제거 (완료, 2026-10-01)
실제로는 **두 군데**서 튀김이 사라지고 있었다.
1. 서버: `correctionFor`의 topic marker가 "먹었**는**데"에 걸려 문장을 "떡볶이 반만"으로 줄였다. modify 명령에 튀김 part 자체가 없었다.
2. 클라이언트: `commitModify`가 `itemsOf(parts)[0]`만 저장했다.

수정 (새 LLM 호출 없음, command type 추가 없음):
- `application/mixedModify.ts`: 정정 phrase와 **같은 문장 전체**를 둘 다 기존 add 파이프라인으로 읽는다. 대상 음식도 아니고 정정 결과와도 겹치지 않는 음식은 `modify_candidate.extraParts`로 넘긴다. 말고/아니고/아니라(대체 문법)면 extras는 없다.
- 음식을 2개 이상 건드리는 modify는 **항상 확인**을 받는다: "떡볶이를 고치고 튀김을 새로 기록할까요?"
- `pendingAdd`: `target.modifyParts`로 정정 part와 추가 part를 구분한다. `planModifyCommit`은 첫 정정 item으로 대상을 교체하고 **나머지는 전부 새 기록**으로 남긴다. 버리는 것은 없다.
- 정정이 무의미하거나(같은 값) 읽을 수 없는데 extras가 있으면, extras를 add로 확인받는다(양 질문 뒤로 숨기지 않음).
- 브라우저: 떡볶이 1인분 기록 → "떡볶이랑 튀김 먹었는데 떡볶이는 반만" → 확인 → 튀김 kcal 질문 → 300 → "바꿨어요: 떡볶이 1인분 → 떡볶이 반 (259 → 130 kcal). 튀김도 기록했어요." 합계 1,065 → 1,236 (−259+130+300) 일치.

## Phase 2 — 8A production spike (구현됨, **기본 off**)
- `ai/judgment/candidateJudge.ts`: 질문 part(ambiguous/unmeasurable/unknown)만 후보로 보내는 **별도 요청**. 재시도 없음, timeout 1500ms.
- `application/candidateFilter.ts`: p(eaten) < `NOUL_THRESHOLDS.candidateEaten`(0.3)인 **질문 part만** 제거. resolved는 구조적으로 건드릴 수 없다. timeout/에러/개수 불일치 → 필터 없이 전부 질문(fallback).
- `application/chatPipeline.ts` (`runChat`): route 로직을 옮긴 곳. 파싱과 후보 요청이 production 판단과 **병렬**로 돈다. add가 아니면 결과를 버린다. route는 이것만 호출한다.
- env `FOOD_CANDIDATE_FILTER=off|on`(기본 off), `FOOD_CANDIDATE_TIMEOUT_MS=1500`. route는 `candidateJudgeFor(env)`만 호출한다(off 또는 키 없음 → null). 응답에 `candidateFilter` 보고(QA용, `components/`는 읽지 않음).
- `pnpm eval:food-judgment`는 이제 `runChat` 그대로를 잰다(2회, 수치 동일):

| | 정확 | silent wrong / drop / nothing | 필요 / 불필요 질문 |
|---|---|---|---|
| 8A 없는 production | 168/191 | 0 / 0 / 3 | 75 / 21 |
| 8A spike | **179/191** | **0 / 0** / 3 | 75 / **9** |
| blind (28) | 22 → **26** | 0 / 0 | 불필요 5 → **1** |
| review (19) | 6 → 12 | 0 / 0 | 불필요 13 → 6 |

나아진 case 11 · **나빠진 case 0** · fallback 0. 뺀 구절 12개: 운동했어, 헬스장 가기 전, 점심을 걸러서 저녁, 너무 맛있었어, 동생이, 같이, 민수, 팀원들, 굶고 점심, 나니까 배불러, 너무 매워, ㅎㅎ 맛있었다.
비용/latency: production p50 ≈200ms / p90 ≈240~265ms. 후보 요청은 전체 문장의 약 50%에서 발생하고 평균 447 tok($0.000019)이다. runChat 전체 p50 ≈209ms / p90 ≈250~267ms로 사실상 차이가 없다. 문장당 평균 **$0.000042** (production 단독 $0.000032).

브라우저(필터 on, 빈 기록, localhost:3001): 빵 터졌네 → clarify(문장 guard) · 김밥 먹으려다가 그냥 굶었어 → clarify(other 0.28) · 떡볶이 먹으려다 참고 샐러드 먹었어 → "참고 샐러드" kcal 질문 유지(파서 경계) · 회의 끝나고 밥 먹었어 → kcal 질문 유지(파서 경계) · 친구랑 김밥 먹었어 → 바로 기록(no_questions) · **팀원들이랑 회식에서 삼겹살 먹었어 → 팀원들 제거, 삼겹살 바로 기록.**
주의: 김밥이 이미 기록된 날에는 "김밥 먹으려다가 그냥 굶었어"가 **delete_food 0.71**로 읽혔다(같은 음식 맥락 문제, 필터와 무관, 확인을 거치므로 조용하지 않음).

## 남은 9건 (필터로 못 없앰)
- 파서 경계 7: 음식 앞뒤에 다른 말이 붙어 unknown이 된다. 회의 끝나고 밥, 참고 샐러드, 김치찌개 먹는 중, 아메리카노 한 잔 더, 김밥 사서 집, 떡볶이는 맛없어서 조금만, 우유로 아침 해결했어.
- 데이터셋 1: "라면에 김치" → 김치가 김치볶음밥|김치찌개|순두부찌개로 모호하다(맨 김치 항목 없음).
- 한 구절에 두 음식 1: "라면 끓여서 계란 두 개 넣고" → 라면|삶은 달걀.
- 별도로, 문장 guard가 막는 먹은 문장 3건(nothing_found, 보이는 실패): 밤 몇 개 먹었어, 커피 한 잔이랑 바나나 하나, 점심은 김밥 저녁은 라면.

## Release Candidate 검증 (2026-10-01)
- test 887 · typecheck · lint 통과. `eval:food-coverage` 163/191 · 0/0/0 · 불필요 30/21(baseline 그대로).
- `eval:food-judgment` 1회: 8A off 168/191 → on 179/191, 불필요 21→9, 0/0, 나빠진 case 0, fallback 0, runChat p50 196ms / p90 231ms, 문장당 $0.000042.
- flag 테스트(`candidateJudge.test.ts`): env 미설정·빈 값 → off, off거나 키 없으면 judge null, 요청은 1회·timeout·재시도 0, 잘못된 답 → throw → fallback. `candidateFilter.test.ts`: resolved는 어떤 값에도 안 빠짐, 실패 3종 fallback, 아무것도 안 뺐을 때 command가 off와 동일.
- RC 중 정리: `isUnreadCorrectionOf` 주석, `evalFoodCoverage`의 옛 "역방향 포함" 명칭 → 구절 내 포함 매칭(28건 모두 맞음), README(음식 109개, 새 eval·env, 안 되는 것 갱신 — `갈비탕 반 그릇만 먹었어`는 이제 181kcal로 정정된다).
- 브라우저 off (localhost:3002·3005, 빈 기록): 김밥 한 줄 · 라면 먹고 커피 · 비빔밥 밥 반 남김→반 그릇 · 양 질문 중 김밥(새 문장으로) · 떡볶이+튀김 반만(확인→튀김 300→1,688−259+130+300=1,859) · 아까 떡볶이 반만(conf 0.84 확인→반 130) · 사과 말고 바나나(바나나만) · 친구랑 김밥(김밥만). 모두 기대대로.
- 브라우저 on (localhost:3003, 빈 기록): 빵 터졌네·굶었어 → 문장 guard clarify · 팀원들이랑 회식 삼겹살 → 팀원들 제거, 바로 기록 · 회의 끝나고 밥·참고 샐러드 → 필터가 남김(실제 음식), Jev 확신 0.76~0.84라 "칼로리를 함께 말씀해주세요" · 친구랑 김밥 → 후보 요청 없음.

## push 전 smoke test (로컬 `pnpm dev`, 필터 off, 빈 기록 — 새 포트면 빈 기록)
1. `git status` 깨끗, `git log`에 RC 커밋 2개, `pnpm test && pnpm typecheck && pnpm lint && pnpm build` 통과
2. 김밥 한 줄 먹었어 → 바로 기록
3. 라면 먹고 커피 마셨어 → 두 음식 한 기록
4. 비빔밥 먹었는데 밥은 반 남겼어 → 양 질문 → "반 그릇" → 320 kcal
5. 양 질문 중 "김밥 먹었어" → 새 문장으로 처리(질문에 먹히지 않음)
6. 떡볶이 먹었어 → "떡볶이랑 튀김 먹었는데 떡볶이는 반만" → "떡볶이를 고치고 튀김을 새로 기록할까요?" → 네 → 튀김 kcal 질문 → 300 → 떡볶이 반 130 + 튀김 300, 합계 일치
7. (새 빈 기록) 떡볶이 먹었어 → 아까 떡볶이 반만 먹었어 → 130 kcal로 정정
8. 사과 말고 바나나 먹었어 → 바나나만 · 친구랑 김밥 먹었어 → 김밥만
9. 응답의 `candidateFilter`가 `{"status":"off"}`인지(개발자도구 Network) — production에서도 push 직후 같은 값이어야 한다

production smoke test는 2~6, 9를 배포된 URL에서 반복한다. 8A를 켤 경우 Vercel env `FOOD_CANDIDATE_FILTER=on` 후 재배포, "팀원들이랑 회식에서 삼겹살 먹었어" → 팀원들 질문 없이 삼겹살 기록되는지, 끄려면 env 제거 후 재배포.

## 다음 결정
- ~~push~~ · ~~8A on~~: 완료(위 "food-input production checkpoint").
- 음식 커버리지 확장: 첫 batch 제안 후 사용자 승인. 조회 → 사람이 row 검토 → FOOD_CD pin → sync → bundled json 순서 유지.
- 같은 음식 맥락의 add/modify/delete 흔들림, 파서 경계 7건: 범위 밖. 규칙 추가 금지.

## RC에 들어간 변경 (2026-10-01, production 배포됨)
수정: `package.json`(eval:food-coverage 스크립트) · `src/ai/nutrition/{dataset,foodPhrases,quantity,types}.ts` · `src/application/addFood.ts` · `src/components/{TodayScreen,replyText}.tsx/ts` · 테스트 5개
신규: `fixtures/food-input-coverage.json` · `fixtures/food-input-coverage.baseline.json` · `scripts/evalFoodCoverage.eval.ts` · `src/application/foodCoverage.ts` · `src/application/foodCoverage.test.ts` · 이 문서
A 수정: `src/ai/nutrition/quantity.ts`(+test) · `src/app/api/resolve/route.ts` · `src/components/TodayScreen.tsx` · Phase 8: `scripts/evalFoodJudgment.eval.ts`, `package.json`(eval:food-judgment), `foodCoverage.ts`의 `isAbout` export
Phase 1: `application/mixedModify.ts`(+test) · `commands.ts`(extraParts) · `pendingAdd.ts`(modifyParts, planModifyCommit) · `replyText.ts` · `TodayScreen.tsx`
Phase 2: `ai/judgment/candidateJudge.ts`(+test) · `application/candidateFilter.ts`(+test) · `application/chatPipeline.ts` · `app/api/chat/route.ts`(runChat만 호출) · `schema.ts` · `env.ts`(envSchema export) · `.env.example` · `confidence.ts`(candidateEaten)
RC: `README.md` · `docs/HANDOFF.md` 상단 · 주석 2곳
push 완료(`5a066fb`). **`main` push = Vercel production 배포.**

## 다음 세션 첫 명령
```
git status --short
pnpm test && pnpm typecheck && pnpm lint
pnpm eval:food-coverage
pnpm eval:food-judgment   # 비용 발생(약 $0.01), 코드가 바뀌었을 때만
```
모두 위 수치 그대로면 RC가 온전하다.
