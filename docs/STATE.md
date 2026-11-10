# 현재 상태 — 공통 인수인계

최종 갱신: 2026-11-10 (KST) Codex 후속 확인·Production 환경변수 3개 저장 완료(배포 전). 로컬 `main` HEAD `0cb557f`, `origin/main`보다 8개 앞섬 · Codex / Claude Code 공용

이 파일은 현재 작업의 진입점이다. 확정 원칙은 [DECISIONS](DECISIONS.md), 실행 규칙은 [AGENTS](../AGENTS.md)를 읽는다. 날짜별 문서는 과거 근거이며, 그 안의 상태·테스트 수·명령·승인 범위가 지금도 유효하다고 가정하지 않는다.

## 2026-11-10 Codex — 후속 확인·운영 환경변수 저장 (배포 전)

- 시작 상태 직접 확인: `main` HEAD `0cb557f`, `origin/main`보다 8개 앞섬, 작업 트리 깨끗함. 사진 입력 `bf8baa6`, Phase 3 묶음 1 `c25cf9d`, 사진 수량 안내·계측 `4cb0c3f`, 인계 문서 `1ca36a9`, 제보 기능 `0cb557f`는 모두 로컬 커밋되어 있다. 아래 과거 실행 시점의 미커밋 표기는 이 Git 확인으로 갱신한다. 이번 push·배포는 하지 않았다.
- 이번 직접 재검증: typecheck·lint·72파일 1,845개 테스트 통과. 오프라인 coverage 195/206(94.7%), silent wrong/drop 0/0, 불필요한 질문 11, 수식어 66/66·경계 13/16(기존 한계 3) 확인. build·실제 API·브라우저·실제 Upstash 쓰기는 아직 실행하지 않았다.
- 사용자 지시: 운영 환경변수를 브라우저에서 입력할 수 있도록 준비하고 저장 직전에만 확인받는다. 준비한 3개 항목에 대해 후속 메시지 "응, 3개 저장해 줘"로 저장을 승인했다. 커밋·push·배포는 이 요청으로 승인된 것으로 해석하지 않는다.
- 브라우저 직접 준비 완료: Vercel `how-much-calories-left` → Environment Variables → Add Environment Variable에서 Production만 선택, `ANTHROPIC_API_KEY`(기존 `.env.local` 키를 Secret 입력, 값 출력·문서 복사 없음), `PHOTO_INPUT=on`, `FOOD_REPORT=on` 3개를 채웠다. Save는 누르지 않았으며 입력 화면을 승인 대기 탭으로 유지했다. 기존 `KV_REST_API_URL`·`KV_REST_API_TOKEN`·`RATE_LIMIT_STORE` Production 항목 존재를 확인했다. RATE_LIMIT_STORE 값 확인은 이메일 재인증을 요구해 취소했고 기존 값을 읽었다고 보고하지 않는다.
- 저장 직접 확인: 사용자 승인 후 브라우저 Save를 눌렀다. Production 목록에 `ANTHROPIC_API_KEY`·`PHOTO_INPUT`·`FOOD_REPORT` 3개가 모두 Secret·Added just now로 표시되고 "Added Environment Variable successfully. A new deployment is needed for changes to take effect." 성공 알림을 확인했다. 승인 시 입력값은 키·`on`·`on`이며 저장 뒤 비밀값을 다시 읽지 않았다. 저장 결과 화면을 탭으로 남겼다.
- 운영 배포 직접 확인(저장 전): Vercel Production은 `22fbbe8` / `dpl_C922TBWNY1kAkqBaj33oaTYG9BeF` Ready였다. 저장 뒤 Redeploy를 누르거나 push하지 않았다. 환경변수는 다음 배포부터 적용되므로 기능 활성화 완료로 보고하지 않는다. 다음 행동: 기능 코드·방침 시행일·모델/한도를 검토한 뒤 배포 승인 범위 확인 및 실제 smoke. 모델·한도는 기존 코드의 잠정 기본값이며 이번에 별도 변수를 추가하지 않았다.
- 이번 저장 후에는 STATE만 갱신했다. 문서 diff를 확인하고, 앱 코드 변경이 없어 앞서 통과한 앱 검증을 반복하지 않았다. `.env.local`·기존 사용자 변경은 보존했다.
- 점검 중 발견한 후속 확인: 제보 UI가 모든 429를 하루 제한으로 표시하고 제보한 음식처럼 버튼을 숨긴다(분당 제한과 구분 필요). 아직 코드 수정하지 않았고 사용자 지시에 따라 운영 UI 준비를 우선한다. 이전에 미검증인 한글 제보 목록 출력도 아직 추가 확인하지 않았다.
- Wiki studio·calories brief 조회 완료. 프로젝트 브리프는 10월 18일 기준 proposed이며 현재 저장소보다 오래돼 운영 상태 근거로 사용하지 않는다.

## 2026-11-10 Claude Code — 못 찾은 음식 제보 버튼 (로컬 커밋 `0cb557f`, 운영 활성화 미확인)

- 사용자 현재 요청: 못 찾은 음식을 버튼으로 운영자에게 제보하는 UI를 제안하고 "구현해". 저장 위치는 Upstash로 확정. 원칙은 [D11](DECISIONS.md#d11-못-찾은-음식은-사용자가-눌러서-제보한다). 시작 HEAD `1ca36a9`, 작업 트리 깨끗한 상태에서 시작.
- 구현(미커밋): [/api/food-report](../src/app/api/food-report/route.ts), [foodReport](../src/application/foodReport.ts)(이름 정규화·검증), [foodReportStore](../src/infrastructure/foodReportStore.ts)(Upstash `ZINCRBY`+`HSET`), 사용 한도에 report 추가, [replyText](../src/components/replyText.ts)의 `제보하기` 선택지와 제보 뒤 답장, [TodayScreen](../src/components/TodayScreen.tsx) 연결, 개인정보처리방침 조건부 문구, 운영자용 [목록 스크립트](../scripts/ops/list-food-reports.mjs). env `FOOD_REPORT`(기본 off, `RATE_LIMIT_STORE=upstash`도 있어야 켜짐), `RATE_LIMIT_REPORT_PER_MINUTE`(3)·`_PER_DAY`(10), `FOOD_REPORTS_PER_DAY`(300). 한도 값은 구현자가 정한 잠정값이다.
- 동작: "○○은 아직 정보가 없어요" 질문에 `빼고 기록` 옆 `제보하기`가 나온다. 누르면 음식 이름만 전송하고 "제보했어요. 추가할 수 있는지 확인해 볼게요."와 함께 같은 질문이 남는다. 같은 이름은 한 방문에서 한 번만 버튼이 나온다. 전송 실패면 버튼이 남고, 하루 한도면 "오늘은 제보를 더 받을 수 없어요."
- 범위 밖으로 둔 것: 문장 전체가 미지원이라 질문 없이 끝나는 답장(`describeNothingAdded`)에는 버튼이 없다. 여러 인스턴스에서 같은 이름이 무한히 늘어나는 것은 일간 상한 300으로만 막는다.
- 검증(이번 직접 실행): typecheck·lint·72파일 1,845개 테스트(새 12개) 통과. 3214 로컬 production 빌드(가짜 Upstash 127.0.0.1:3298, Jev 키를 비워 mock 판단, 계정 off)에서 확인: 버튼 표시 → 제보 200·전송 본문은 `{"name":"뽀로롱떡"}`뿐 → 저장소에 이름·횟수·날짜만 → 같은 음식 재입력 시 버튼 없음 → 브라우저 하루 한도(시험값 2) 초과 시 429와 안내, `빼고 기록` 흐름 유지, 375px 가로 넘침 없음, 방침에 제보 문구 표시. 시험 저장값을 지우고 서버를 모두 종료했다.
- 미검증: **실제 Upstash에 대한 쓰기와 목록 스크립트의 데이터 출력**(가짜 저장소로만 확인, 스크립트는 빈 목록·삭제만 확인. 데이터를 넣어 보는 시험은 Windows 셸 인코딩 문제로 실패), 실제 Jev 판단 경로에서의 버튼 표시, 운영 환경.
- 운영 변경·커밋·push 없음. 켤 때 할 일: Vercel `FOOD_REPORT=on`, 방침 `EFFECTIVE_DATE` 갱신, push 승인, 운영에서 제보 1건과 목록 조회 smoke.

## 2026-11-10 Claude Code — 사진: 여러 개가 보이면 하나로 적고 안내 (미커밋)

- 사용자 결정(이번 대화): 시험에서 드러난 문제 ④(`뚱카롱 1상자`)에 대해 "최소 단위 1개를 먹은 것으로 적고, 몇 개 먹었는지 고칠 수 있다고 글로 알린다". [D10](DECISIONS.md#d10-사진은-문장을-채우는-보조-입력이다)에 추가했다.
- 변경(미커밋): 모델 출력에 `one_of_several` 표시를 추가하고 [프롬프트](../src/ai/photo/recognizer.ts)를 고쳤다. 양은 앱이 읽는 단위(그릇·공기·접시·인분·개·조각·장·줄·잔·컵·캔·병·봉지)로만, 용기(팬·뚝배기·상자·통·종지)는 쓰지 않고, 소스·양념·고명은 뺀다. 표시된 음식이 있으면 입력창 아래 안내가 "사진으로는 먹은 양을 알 수 없어 하나만 적었어요: 뚱카롱. 먹은 만큼 숫자를 고친 뒤 기록을 눌러 주세요."로 바뀐다([photoInput](../src/components/photoInput.ts)).
- 실제 재확인(Anthropic 3건, 앞서 승인된 최대 20회 안, 누계 13회): 마카롱 상자 → `뚱카롱 1개` + 위 안내, 찜닭 포장 → `찜닭 1인분` + 위 안내, 돈가스 한 상 → `돈까스 1접시, 계란후라이 1개, 양배추 샐러드, 쌀밥 1공기, 된장찌개 1그릇, 파김치, 단무지`(소스·종지 사라짐, 일반 안내). 안내 문구는 이 확인 뒤에 한 번 다듬었고 다듬은 문구는 단위 테스트로만 확인했다.
- 검증: typecheck·lint·71파일 1,833개 테스트·시험 전용 build 통과. 서버와 임시 파일 서버 종료, 시험 저장값 삭제.
- 미해결(아래 시험 기록의 ①②③⑥): 문자 경로의 `장`·`접시` 등 단위 처리, `양배추 샐러드`→코울슬로, 미지원 음식, "말씀하신 음식" 문구. 돈가스가 `2장`에서 `1접시`로 바뀐 것은 프롬프트 변경의 부수 효과이며 나머지 7장은 새 프롬프트로 다시 돌리지 않았다.
- 운영 변경·커밋·push 없음.

## 2026-11-10 Claude Code — 사진 입력 실제 시험 (사진 10장, 미커밋)

- 사용자 현재 요청: [인계](product/photo-input-test-handoff-2026-11-10.md) 확인 뒤, 제시한 범위(사진 10장 각 1회, 대표 문장 3건 기록, 로컬 3213 전용 서버, 운영·커밋·push 없음)에 "실행해"로 승인. 시작 HEAD `2f49196`, Phase 3 묶음 1 미커밋 변경이 작업 트리에 있는 상태로 빌드했다(문자 경로 결과에 그 변경이 포함된다).
- 사진: 사용자가 `photo-samples/`에 넣은 JPG 10장(Git 제외). 기대값 `manifest.csv`는 호출 전에 Claude Code가 사진을 보고 적었다. **사람이 확인한 기대값이 아니며**, 인식 모델과 같은 계열의 모델이 적은 것이라 편향이 있을 수 있다.
- 코드 변경(미커밋): 비용 실측용으로 `PHOTO_USAGE_LOG`(기본 off)를 추가했다. on이면 [recognizer](../src/ai/photo/recognizer.ts)가 응답 모델과 토큰 수만 서버 로그에 남긴다(사진·읽은 내용 없음). `.claude/launch.json`의 `verify-photo-live`에 인계 문서의 환경값을 넣었다.
- 인식 결과(실제 Anthropic 호출 10건, 재시도 없음): 10/10 HTTP 200·`food`, 음식 이름은 10장 모두 기대 범위. 지연 1.5~4.5초. 요청·응답 모델 모두 `claude-opus-5-5`, fallback 발생 0. kcal·영양소 표현 0건. 전송본은 모두 긴 변 1280px JPEG·15~35만 바이트(원본 3~4.7MB), 전송본 앞부분에 Exif 표식 없음. 사진만으로 기록된 건수 0(10/10). 첫 사용 안내는 취소 시 업로드 없음, 동의 후에만 선택 열림. 기존 입력 뒤에 붙는 동작 확인. 사진별 표는 로컬 `eval-results/photo-input-20261110-1330/results.csv`(Git 제외).
- 비용 실측: 장당 입력 2,442토큰(10장 동일)·출력 34~236토큰, 합계 입력 24,420·출력 741. 단가 입력 $4·출력 $20/100만 토큰(claude-api 스킬의 2026-11-03 캐시 표 기준, 공급자 페이지를 이번에 다시 조회하지는 않음)으로 계산하면 합계 약 $0.11, **장당 약 1.1센트**. 일간 상한 200회면 하루 약 $2.3.
- 문자 경로(실제 Jev 3건, 판단 출처 `jev`): 사진이 만든 나열 문장을 "먹었어" 없이 그대로 `기록` → 3건 모두 add로 판단. 2건은 미지원 음식을 빼고 저장까지 확인, 1건은 질문 단계에서 종료. 로컬은 `FOOD_CANDIDATE_FILTER`가 꺼져 있어 운영(켜짐)과 다르다.
- 드러난 문제(Phase 3 후보, 고치지 않음): ① 사진이 쓰는 단위 `종지`·`팬`·`뚝배기`·`상자`·`접시`·`장`·`조각`을 양으로 읽지 못해 `파김치 1종지`가 이름째 미지원이 되거나 `돈까스 2장`이 1인분으로 잡힘 ② `양배추 샐러드` → 코울슬로 225kcal로 연결(의심) ③ 미지원: 뻥튀기, 파김치, 비빔 막국수, 뚱카롱 ④ 포장 전체(`뚱카롱 1상자`, 찜닭 한 통)를 먹은 양처럼 적음 ⑤ 소스(`돈까스 소스 1종지`)를 음식으로 내고 8개 상한에 닿음 ⑥ 미지원이 둘일 때 두 번째 질문과 마지막 답장이 음식 이름 대신 "말씀하신 음식"으로 나옴.
- 검증: typecheck·lint·71파일 1,832개 테스트 통과(계측 추가 후), 시험 전용 설정 production build 통과. 시험 기록은 3213 origin의 localStorage에서 지웠고, 서버와 임시 파일 서버(127.0.0.1:3299, 사진 폴더 읽기 전용)를 종료했다.
- 미검증: 사람이 확인한 기대값 대비 정확도, 음식 아닌 사진·어두운 사진·영양성분표 사진, 정정·삭제 흐름(Jev 승인 범위 밖), 실제 휴대폰 카메라·Safari·HEIC, 운영의 음식별 필터가 켜진 상태. 표본 10장은 품질을 일반화하기에 작다.
- 운영 변경·커밋·push 없음. 다음 행동: 사용자가 결과 확인 → 모델·한도 확정과 운영 활성화 여부 결정(시행일 갱신·키 등록·push는 별도 승인), 위 ①~⑥을 Phase 3 묶음 2로.

## 2026-11-10 Codex — Claude Code용 사진 테스트 준비 (실행 안 함)

- 현재 사용자 요청: 작업 상황을 파악하고 **Claude Code 세션이 테스트할 수 있도록 세팅만** 한다. 웹 사진 수집·이미지 생성·테스트 실행은 하지 않는다. 실제 호출은 후속 사용자 지시로 범위를 확인한 뒤 한다. 과거 호출·키 등록을 새 과금 승인으로 재사용하지 않는다.
- 시작 브랜치 `main`, HEAD `2f49196`. 기존 변경: `.claude/launch.json`, 이 STATE, roadmap, coverage 기준선, foodPhrases, addFood, candidateFilter 테스트 및 미추적 nonFood 코드·테스트. 기존 변경을 보존했으며 앱 코드·환경 파일·launch 설정·운영 설정은 바꾸지 않았다. Wiki studio·calories brief를 조회했고 오래된 proposed 색인보다 저장소 정본을 우선했다.
- 준비: [테스트 인계](product/photo-input-test-handoff-2026-11-10.md), [사진 폴더 안내](../photo-samples/README.md), 빈 사진 목록·결과 CSV 양식. `.gitignore`는 이 안내·양식만 추적하고 사진·실제 목록은 제외한다. 실제 결과는 기존 Git 제외 경로 `eval-results/`에 둔다. 자동 실행기·토큰 계측 코드는 추가하지 않았다.
- 현재 직접 확인: `.env.local` 파일 존재(내용·키 값·유효성 미확인), 사진 폴더에 이미지 없음, 기존 3213 launch는 start만 수행, recognizer는 usage·실제 model을 반환하지 않음. 인계에는 동일 설정의 build/start, 테스트 전용 브라우저·계정 off·메모리 제한, 사진만으로 자동 기록되지 않는 경계, 나열 문장의 실제 Jev 확인, 미측정 비용 구분을 적었다.
- 검증: 문서 상대 링크·CSV 헤더·Git 제외 규칙·diff 확인. 문서·Git 제외 규칙만 바꾸었으므로 앱 typecheck·lint·test·build·브라우저 QA는 재실행하지 않았다. 서버 실행·이미지 다운로드/생성·Anthropic/Jev 호출 0건. 실제 사진 품질·기록 경로·비용 실측은 미검증 그대로다.
- 다음 행동: Claude Code는 위 인계부터 읽는다. 사용자 제공 사진과 후속 실행 범위·과금 승인 전에는 준비 상태를 유지한다. 운영 활성화·모델/한도 확정·커밋·push·배포는 하지 않았다. D10 제품 원칙은 바뀌지 않아 DECISIONS는 수정하지 않았다.

## 2026-11-10 Claude Code — 로컬 커밋 4개와 Phase 3 묶음 1 (미커밋)

- 사용자 승인으로 로컬 커밋(이번 대화, push 없음): `bf8baa6` 사진 입력, `059be2f` 만든 사람 링크, `16be6c6` 운영 문서 2개, `2f49196` Upstash 에이전트 스킬·`.claude/launch.json`. 로컬 `main`이 `origin/main`(`22fbbe8`)보다 4개 앞선다. production은 `22fbbe8` 그대로다. 아래 "미커밋" 표기 중 Phase 2는 `bf8baa6`으로 커밋됐다.
- Phase 3 묶음 1(미커밋): 음식이 아닌 말을 음식으로 묻던 유형을 파서에서 고쳤다. 변경은 [nonFood](../src/ai/nutrition/nonFood.ts)(신규), [foodPhrases](../src/ai/nutrition/foodPhrases.ts), [addFood](../src/application/addFood.ts), 기준선 fixture, 테스트. 상세와 남은 11건은 [계획 문서](product/roadmap-2026-11-10.md#묶음-1-2026-11-10-미커밋--음식이-아닌-말을-묻지-않기).
- 검증(이번 직접 실행): `eval:food-coverage` 정확 177 → 195/206, silent wrong/drop 0/0, 불필요한 질문 31 → 11, 퇴보 0. `eval:food-modifiers` 66/66·경계 13/16(허용 한계 3). typecheck·lint·71파일 1,832개 테스트·production build 통과. 화면 변경이 없어 브라우저 확인은 하지 않았다.
- 미실행: `eval:food-judgment`(Jev 과금, 판단 경로 미변경), 운영 배포·smoke.
- 다음 행동: 묶음 1 커밋 승인 → (선택) push·배포 승인과 smoke.
- Phase 2 후속(같은 날): 사용자가 로컬 `.env.local`에 Anthropic 키와 `PHOTO_INPUT=on`을 넣었다(값은 확인·기록하지 않음). 3213 로컬 production 빌드에서 **실제 모델 호출 1건** 성공: 캔버스로 그린 그림(바나나 모양, `콜라 355ml` 글자가 있는 캔)을 `/api/photo`로 보내 200·약 3초·`바나나 1개, 콜라 355ml`. 키·모델 ID·fallback 파라미터·구조화 출력 연결은 확인됐다. 실제 식사 사진의 인식 품질, 토큰·비용 실측, 채워진 문장의 Jev 판단은 아직 미검증이다. 시험 사진은 사용자 제공 대기. `.claude/launch.json`에 `verify-photo-live`(3213)를 추가했다(미커밋). 운영 키·스위치는 등록하지 않았다.

## 2026-11-10 Claude Code — Phase 2 사진 입력 구현 (스위치 off, 미커밋)

- 사용자 현재 요청: "주소 이전을 마쳤으니 확인만 하고 Phase 2 진행". 시작 브랜치 `main`, HEAD·원격 `22fbbe8`. 기존 미커밋 변경(문서 4개, AccountScreen, 도구 파일)은 그대로 두었다.
- Phase 1 직접 재확인(읽기만): 새 주소 `/`·`/import` 200, canonical `https://calories.hetrich.com`, 옛 주소 `/`에 이전 안내 문구. 본문 없는 `POST /api/auth/start`는 500이었다(폼이 아닌 요청에서 `formData()`가 던짐, 이전부터의 동작으로 보이며 고치지 않았다. 정상 폼 경로는 아래 Codex 기록의 400/403).
- 구현(미커밋): [/api/photo](../src/app/api/photo/route.ts), [recognizer](../src/ai/photo/recognizer.ts), [photoCandidates](../src/application/photoCandidates.ts), [photoInput](../src/components/photoInput.ts), [ChatInput](../src/components/ChatInput.tsx) 사진 버튼, 사용 한도에 photo 추가, 개인정보처리방침 조건부 Anthropic 행, env `PHOTO_INPUT`(기본 off)·`PHOTO_MODEL`·`PHOTO_TIMEOUT_MS`·사진 한도 3종. 의존성 `@anthropic-ai/sdk` 1.6.0 추가. 원칙은 [D10](DECISIONS.md#d10-사진은-문장을-채우는-보조-입력이다), 항목별 상태는 [계획 문서 Phase 2](product/roadmap-2026-11-10.md#phase-2--사진-인식-적당한-완성도).
- 검증(이번 직접 실행): typecheck·lint 통과, 70파일 1,788개 테스트 통과(새 16개), production build 통과. 3212 로컬 production 빌드(`PHOTO_INPUT=on`, 가짜 키, 계정 off)에서 확인: 첫 사용 안내 → 동의 후에만 파일 선택 열림, 3000×2000 PNG가 1280×853 JPEG로 바뀌어 전송, 가짜 키라 서버 503·"사진을 읽지 못했어요" 안내·서버 로그에는 오류 이름과 상태만, `/api/photo` 응답을 화면에서 바꿔 끼운 경우 입력창에 문장이 채워지고 안내 표시, 375px 가로 넘침 없음, 방침에 Anthropic 행 표시. 기본값 빌드에서는 버튼과 방침 문구가 없다. 시험 데이터는 지웠고 서버는 껐다.
- 미검증: **실제 모델 호출과 인식 품질**(로컬·운영 모두 키 없음), 채워진 나열 문장을 실제 Jev가 기록으로 받는지, 실제 휴대폰 카메라·Safari·HEIC, 비용 실측.
- 운영 변경 없음. 커밋·push 없음. production은 `22fbbe8` 그대로이며 이 코드가 배포돼도 스위치가 off이면 동작이 같다.
- 다음 행동(사용자): Anthropic API 키 발급, 모델·한도 잠정값 확인, 시험용 식사 사진. 그 뒤 실제 사진 시험(과금, 실행 전 확인) → 키·스위치 등록과 시행일 갱신 → 커밋·push 승인 → smoke. 이어서 Phase 3.

## 2026-11-10 Codex — 도메인 이전 운영 설정·전환 배포

- 사용자 현재 요청으로 이전 로그의 남은 작업을 이어받았다. 시작 브랜치 `main`, HEAD·원격 `a2dc622`. 기존 미커밋 변경은 보존한다. Wiki studio·calories brief를 조회했으며 오래된 운영 상태보다 저장소 정본과 이번 직접 조회를 우선했다.
- 가비아 로그인 세션에서 `hetrich.com`에 `CNAME calories → b6432e89f07c4a81.vercel-dns-017.com.`(TTL 600) 하나를 추가하고 저장 완료·4개 레코드를 확인했다. 기존 `@`·`www`·`rooftop` 유지. 권한 DNS 응답과 Vercel `domains verify`의 `configured_correctly`를 직접 확인했다.
- 새 도메인을 기존 production `dpl_BJkZzDd9BC4ybgey6uVAwBN4fHBQ`에 alias로 연결했다. 인증서 `cert_82wKPPZCxveucOA2SF34Afsw` 발급, `https://calories.hetrich.com/` 200과 `/api/account`의 configured=true 확인. 이 시점에는 새 주소와 옛 주소가 기존 앱을 함께 제공하며, 로그인 origin은 아직 옛 주소다.
- 사용자가 Supabase 대시보드에 로그인한 뒤 Site URL을 `https://calories.hetrich.com`으로, Redirect URLs에 `https://calories.hetrich.com/api/auth/callback`을 추가·저장했다. 기존 운영·localhost 콜백은 유지했다. DB·공급자 비밀값·계정 데이터는 변경하지 않았다. Vercel MCP 팀 권한 403은 기존 CLI 인증으로 대체했으며 연결 권한을 확대하지 않았다.
- 이번 직접 재검증: typecheck·lint·69파일 1,772개 테스트·production build·diff check 통과. 기존 로컬 두 주소 브라우저 검증은 아래 Claude 기록이며 이번 재실행으로 표시하지 않는다.
- 사용자에게 구체적인 전환 내용(`APP_ORIGIN`·`LEGACY_HOSTS`, 커밋·main push, 옛 주소 안내)을 제시했고 **이번 대화에서 전환 배포까지 승인받았다**. 도메인 이전 파일과 관련 문서만 커밋한다. 만든 사람 링크, 운영 체크리스트, 도구 설정·설치 파일은 제외한다.
- 전환 직전 되돌릴 배포: `dpl_BJkZzDd9BC4ybgey6uVAwBN4fHBQ` / `a2dc622`. 이전 `APP_ORIGIN=https://how-much-calories-left.vercel.app`, `LEGACY_HOSTS` 미설정. 롤백할 때 환경변수도 복원해야 이후 재배포에서 다시 전환되지 않는다.
- 전환 완료: production `APP_ORIGIN=https://calories.hetrich.com`, `LEGACY_HOSTS=how-much-calories-left.vercel.app` 설정 후 `22fbbe8` 커밋·main push. production `dpl_C922TBWNY1kAkqBaj33oaTYG9BeF` Ready, 새 주소·옛 주소 alias 반영 확인(12:11 KST). 이전 코드·문서는 위 커밋에 포함했고 제외한 기존 변경은 그대로 남겼다.
- 운영 smoke 직접 확인: 새 주소 `/`·`/account`·`/privacy`·`/import`·`/api/account` 200, canonical 새 주소, 계정 configured=true. 옛 주소 `/`·`/history`·`/account` 모두 이전 안내 및 새 주소 표기. 크롬 화면에서도 안내·기록 옮기기 버튼과 새 주소의 Google·카카오 로그인 버튼을 확인했다. 사용자 원본 기록은 가져오기나 수정 없이 보존했다. 실제 두 주소 사이 가져오기 저장 동작은 아래 로컬 검증과 이번 전체 테스트로 확인했으며 운영 사용자 기록으로 시험하지 않았다.
- 운영 `/api/chat` 직접 요청 2건: `김밥 한 줄 먹었어` → 322 kcal, `라면 반 봉지 먹었어` → 약 226 kcal·반 그릇 추정 기준(모두 200, 실제 Jev). API 직접 호출이라 식사·대화 기록을 저장하지 않았다. auth/start는 새 Origin의 동의 누락 요청 400, 옛 Origin 403으로 전환 경계 확인. 해당 배포의 최근 15분 error·warning·fatal 로그 0건(12:12 KST 조회), 부하·한도 초과 테스트는 하지 않았다.
- 사용자 실제 확인: 새 주소에서 **Google·카카오 모두 로그인 성공**했다고 이번 대화에서 답했다. Codex도 그 뒤 새 주소의 오늘 화면 정상 진입을 관찰했다. 공급자 두 번의 전체 인증 과정은 사용자가 수행한 확인이며 Codex가 직접 재현한 것으로 표시하지 않는다.
- Wiki에는 도메인 전환 관찰을 proposed 상태로 남겼다. 최초 제안의 필수 claim 누락을 이번에 생성한 inbox 노트에서 바로잡았고 최종 validate 오류 0·기존 경고 4를 확인했다. 소유자 승인이나 프로젝트 색인 확정으로 표시하지 않는다.
- Phase 1 전환 완료. 다음 행동: Phase 2 사진 모델·비용 상한을 정한 뒤 기능 스위치 off 상태로 구현·검증. 사진 기능·커버리지 개선은 아직 구현하지 않았다. 이 배포 후 상태·운영 메모 갱신은 로컬 문서 변경이며 추가 커밋·push하지 않았다(문서 때문에 production 배포를 반복하지 않음). 문서 내용·링크·diff를 확인했고 코드 변경이 없어 앱 검증은 반복하지 않았다.

## 2026-11-10 Claude Code — 도메인 이전·사진 인식·입력 품질 계획 (문서만)

- 사용자 요청: 주소를 `calories.hetrich.com`으로 변경, 사진 인식 추가(적당한 완성도), 문자 입력 유지하며 예외 케이스·음식 커버리지 확대. 페이즈별 진행 허용. [페이즈 계획](product/roadmap-2026-11-10.md)을 작성했다. 기준 HEAD `a2dc622`.
- 읽기 전용 조사로 확인: `hetrich.com`은 같은 Vercel 팀에 있고 네임서버는 가비아, `calories.hetrich.com` DNS 레코드 없음. 로그인은 `APP_ORIGIN` 한 주소에만 묶임. 비로그인 기록은 origin별 localStorage라 옛 주소를 바로 넘기면 새 주소에서 보이지 않음. production에 `ANTHROPIC_API_KEY` 없음, TypeSafe SDK에 이미지 입력 없음.
- 코드·운영 설정·DNS는 바꾸지 않았다. 문서만 추가·갱신해 링크와 diff만 확인했고 앱 검증은 실행하지 않았다. 커밋·push 없음. 기존 미커밋 변경 보존.
- 다음 행동: 사용자가 계획의 결정 ①(옛 주소 처리)·②(사진 모델·키) 답 → Phase 1부터 진행.

### 후속: Phase 1 구현 (같은 날, 미커밋)

- 사용자 결정: 옛 주소는 살려 두고 안내 + 기록 옮기기.
- 운영 변경 1건: Vercel 프로젝트에 `calories.hetrich.com`을 추가했다. 가비아에 `CNAME calories → b6432e89f07c4a81.vercel-dns-017.com.`이 필요하며 아직 없다(사용자). 환경변수·배포·Supabase 설정은 바꾸지 않았다. 지금 운영 동작은 이전과 같다.
- 코드(미커밋): [proxy](../src/proxy.ts)·[legacyHost](../src/application/legacyHost.ts)(`LEGACY_HOSTS`의 host는 모든 페이지를 `/moved`로), [originMove](../src/application/originMove.ts)·[localMove](../src/infrastructure/localMove.ts)(기록을 URL `#` 뒤에 묶기·검증·합치기), [MovedScreen](../src/components/MovedScreen.tsx), [ImportScreen](../src/components/ImportScreen.tsx), `/moved`·`/import` 페이지, env `LEGACY_HOSTS`, `metadataBase`·홈 canonical. 계산기 신체정보는 옮기지 않는다. 상세는 [계획 문서](product/roadmap-2026-11-10.md#옛-주소-처리-구현).
- 검증: typecheck·lint 통과, 69파일 1,772개 테스트 통과(새 17개), production build 통과. 3211 로컬 production 빌드를 `localhost`(새 주소 역할)·`127.0.0.1`(옛 주소 역할)로 열어 확인: 옛 주소의 `/`·`/history`·`/account`가 안내로 바뀜, 옮기기 → 새 주소에서 건수 확인 → 가져오기 → 오늘 화면에 기록 표시, 주소창 `#` 제거, 원본 유지, 신체정보 미전달, 깨진 링크는 저장 없이 안내, 375px 가로 넘침 없음, 콘솔·서버 오류 없음. 테스트 데이터는 지웠다. 실제 도메인·로그인·Safari는 확인하지 않았다.
- `.claude/launch.json`(미추적)에 `verify-move`(3211, 두 환경변수 지정)를 추가했다.
- 남은 순서: 사용자 가비아 CNAME·Supabase URL 설정 → `APP_ORIGIN`·`LEGACY_HOSTS` 설정과 커밋·push를 한 번에(승인 필요, 먼저 하면 로그인이 끊김) → 새 주소 smoke와 실제 로그인. 커밋·push 없음.

## 2026-11-08 Claude Code — 브라우저 QA 5건 대응

- 사용자 요청: [QA 결과](product/live-browser-qa-2026-11-08.md)에 대응해 수정 후 배포. 기준 HEAD·`origin/main` `ad5b344`, production `dpl_E5fALeZ2g4HaSCw38EXjHX5Je5Gv`(되돌릴 대상).
- QA-01 `라면 반 봉지` → 1그릇: 단위 크기를 모르는 음식은 1회분으로 대체하던 경로가 `반`을 버렸다. 1 미만의 몫(반·1/2·1/3)은 그 비율의 1회분으로 기록한다(`라면 반 그릇 ~226`, "1그릇의 절반으로 잡았어요"). 1 이상(`만두 5개` → 1인분)은 기존 그대로. [addFood](../src/application/addFood.ts) `estimateFor`.
- QA-02 `먹을까?` → `먹었어` 미연결: 답장이 `"떡볶이 먹었어"`처럼 음식명을 넣어 안내하고, 음식 질문 답장 바로 뒤의 단독 `먹었어`(응/네/결국 포함)는 화면이 그 음식 문장으로 보낸다. 섭취 판단은 그대로 Jev. [talkFollowUp](../src/application/talkFollowUp.ts), [TodayScreen](../src/components/TodayScreen.tsx).
- QA-03 `먹으려다가 안 먹었어` → 삭제 후보: Jev가 실제로 `delete_food`로 판단함을 로컬 운영 빌드에서 재현. 먹지 않았다는 문장에 기록을 가리키는 말(지워·취소·잘못·기록·사실·먹었다고·아까 등)이 없으면 수정·삭제를 하지 않고 "안 드신 건 기록하지 않았어요"로 답한다. 같은 음식 기록이 있으면 `"라면 지워줘"` 방법을 함께 안내. [commands](../src/application/commands.ts) `saysOnlyNotEaten`, [smallTalk](../src/application/smallTalk.ts).
- QA-04 `한 봉지 끓였는데 반만 먹었어` → 미등록 음식: 끓였는데·시켰는데·샀는데·데워서 등 음식을 바꾸지 않는 준비 동사 뒤에 양만 오면 앞 음식의 그 양으로 읽는다(`라면 반 봉지` → QA-01 경로). 앞 양의 비율로 계산(`두 줄 … 반만` → 1줄), `다 먹었어`는 전량, `반은 남겼어`는 뺄셈. 구워서·삶아서는 다른 음식이 되므로 제외(기존 L10·L11 fixture 유지). [foodPhrases](../src/ai/nutrition/foodPhrases.ts).
- QA-05 `내일 떡볶이 먹을 거야` → 일반 안내: `내일` 등이 음식명에 붙어 조회가 실패했다. 시간어를 떼고, 먹을 계획은 계획으로 답한다(다른 날이면 남은 양 없이 "아직 드시기 전이라 기록하지 않았어요"). `먹을 거야/예정/먹을게`는 파서에서도 섭취로 읽지 않는다.
- 검증: 68파일 1,755개 테스트(새 [QA 회귀 테스트](../src/application/qa20261108.test.ts) 포함), typecheck, lint, production build 통과. 3210 로컬 production 빌드에서 실제 Jev로 QA 문장 5건과 대조 문장(`라면 반 그릇`, `김밥 먹었어`, `바나나 지워줘`) API 확인, 화면에서 QA-01·02·03 흐름과 답장 확인, 서버 오류 없음. 테스트 기록은 인앱 브라우저 localhost 저장소에만 생겼다.
- 미커밋 상태로 두는 것: [AccountScreen](../src/components/AccountScreen.tsx) 만든 사람 링크(10-31, 결정 대기), 운영 체크리스트 diff, `.agents/`·`skills-lock.json`·`.claude/launch.json`.
- 배포: 사용자 요청으로 `a2dc622`를 main push. production `dpl_BJkZzDd9BC4ybgey6uVAwBN4fHBQ` Ready(18:59 KST) 및 운영 alias 반영 확인. 되돌릴 대상은 `dpl_E5fALeZ2g4HaSCw38EXjHX5Je5Gv` / `ad5b344`.
- 운영 재확인: 운영 `/api/chat`에 QA 문장 5건과 대조 문장 4건을 직접 보내 로컬과 같은 결과를 확인했다(모두 200, 실제 Jev). API 직접 호출이라 사용자 기록은 생기지 않는다. 운영 화면에서의 `먹었어` 이어받기는 로컬 production 빌드 화면으로만 확인했고 운영 화면 재확인은 하지 않았다. 이 STATE 갱신은 배포 뒤 로컬 문서 변경이며 커밋하지 않았다.

## 2026-11-08 Codex — 운영 페이지 브라우저 QA 인계

- 사용자의 요청으로 실제 공개 페이지에서 수행한 두 차례의 수동 브라우저 검증을 [QA 결과 문서](product/live-browser-qa-2026-11-08.md)로 정리했다. 명시한 `라면 반 봉지`가 1그릇으로 기록된 사례 등 결함 후보 5건과 기대대로 동작한 주요 흐름을 입력·기대·실제 결과로 구분했다. 이 문서는 관찰 기록이며 수정·회귀 확인 완료를 뜻하지 않는다.
- 검증 당시 목표는 2,540 kcal였다. 테스트 식사 기록은 UI에서 전부 제거했고 새로고침 후 오늘 0 kcal를 확인했다. 테스트 대화는 브라우저 대화 기록에 남아 있다. 로그인 상태, 서버 저장, 모바일·날짜 경계는 이번 QA 범위 밖이다.
- 이번 작업은 문서만 추가·갱신했다. 문서 링크·내용·diff를 확인하고 앱 테스트·빌드는 실행하지 않는다. 기존 미커밋 변경은 보존하며 코드·운영 설정·배포는 바꾸지 않았다. 커밋·push 없음. 다음 행동: 작업 세션에서 QA-01부터 재현·원인 확인·수정 후 운영 회귀 검증.

## 2026-10-31 Claude Code — 내 계정 푸터에 만든 사람 링크 (미커밋)

- 사용자 요청으로 [AccountScreen](../src/components/AccountScreen.tsx) 푸터의 개인정보처리방침 옆에 `만든 사람` → `https://hetrich.com/?ref=calories` 링크를 추가했다. 로그아웃 버튼의 오른쪽 배치를 유지하려고 왼쪽 두 링크만 묶었다.
- 검증: 로컬 dev `/account`에서 데스크톱·375px 폭 모두 링크 노출과 가로 넘침 없음을 확인했다. 로컬은 로그인 미설정 화면이라 로그인 상태의 로그아웃 버튼과 나란한 배치는 화면으로 확인하지 못했다. typecheck와 해당 파일 eslint 통과. 전체 vitest와 production build는 이 컴포넌트를 다루는 테스트가 없어 실행하지 않았다.
- 커밋·push·배포는 하지 않았다. 기존 미커밋 변경과 미추적 파일은 그대로 두었다. 다음 행동: 사용자가 커밋·배포 여부를 결정한다.

## 2026-10-26 Codex — 운영 순차 적용 진행

### 후속: Upstash 운영 완료, 카카오 도구 오류로 미적용

- 사용자 약관 동의 후 Upstash `hmcl-rate-limit` (`store_MxpCpF8mUwQjnUbJ`) 생성·production 연결 완료. Free 플랜(월 500,000 commands), 미국 동부 iad1, `autoUpgrade=false`, `prodPack=false`, `eviction=false`로 생성했다. Free·iad1·production 연결은 생성 후 다시 확인했다. `.env.local` pull은 하지 않았다.
- `RATE_LIMIT_STORE=upstash` 설정 후 2차 production `dpl_E5fALeZ2g4HaSCw38EXjHX5Je5Gv` Ready 및 운영 alias 반영(2026-10-26 22:42 KST). 코드 `ad5b344` 유지. 이번 단계의 직전 배포는 `dpl_CZVKF82V4UspGACZ2R9cE9u2n1Fs`이며, 되돌릴 때 환경 설정도 memory로 복원해야 한다.
- 실제 로그인 상태의 인사 입력 성공, Redis Browser에서 `hmcl:rl:` chat IP·account·Jev 키 5개와 TTL 확인. 해당 배포 warning/error 로그 0건. `/privacy`에 Upstash·미국 동부 안내가 노출되는 것 확인. 운영 한도 초과 부하 테스트는 하지 않았다.
- 카카오 `apply_migration` 두 번 모두 `Invalid or expired requestState` 오류. 각 시도 뒤 재조회했고 lifecycle/recovery 테이블이 모두 없음을 확인했다. migration은 미적용이며 앱 recovery 플래그·DB 스위치·함수·웹훅도 미변경이다. 정책 거절로 보고하지 않으며 도구 요청 상태 오류로 구분한다. 다음은 migration 도구 오류 해결 후 DB 적용·실제 스키마 검증부터 재개.
- Vercel CLI가 Upstash 설치 중 `.agents/skills/upstash-redis-js`, `.agents/skills/upstash-ratelimit-js`, `skills-lock.json`을 자동 생성했다. 기존 `.claude/launch.json`과 함께 미추적으로 보존했고 커밋하지 않았다. 앱 코드 변경 없음; 운영 검증과 문서 diff 검사로 확인한다.

- 사용자가 기본 앱 배포·A1 실계정 확인 → Upstash → 카카오 운영 적용을 현재 요청으로 지시했다. 아래 과거의 push 미승인·미배포 기록은 당시 상태다.
- 1차 배포 완료: `main`의 6개 커밋을 `ad5b344`까지 push했다. Vercel production은 `dpl_CZVKF82V4UspGACZ2R9cE9u2n1Fs` Ready(22:16 KST 생성), 운영 alias 반영 확인. 직전 되돌릴 배포는 `dpl_BfCvZwnGyijeF7xjqSh627wfrvAF` / `67a33f5`다.
- 설정: `ACCOUNT_ENABLED=on`, `RATE_LIMIT_STORE` 미설정(memory), `ACCOUNT_RECOVERY_ENABLED` 미설정(off). 배포 전 67파일·1,711개 테스트, typecheck, lint, production build 모두 통과.
- 사용자가 브라우저에서 직접 로그인한 뒤 테스트 입력 1회를 보냈다. Vercel 요청 로그에서 `POST /api/account/data` 1회·200(22:19:15 KST), 해당 로그인 계정 revision 42→43, 새로고침 후 식사·답장 유지 확인. `batch` 본문은 운영 네트워크 캡처가 아니라 배포 소스와 테스트로 확인했다. 테스트 식사는 UI에서 지웠고 대화는 남는다. 다른 계정의 기록은 조회하지 않았다.
- `/privacy`에서 실제 게시일 2026-10-26과 백업 안내 확인. Upstash·복구 기능은 아직 off라 관련 조건부 문구는 비노출.
- Upstash 생성 대기: `upstash/upstash-kv`, Free(월 500,000 commands·카드 불필요), `primaryRegion=iad1`, `autoUpgrade=false`, `prodPack=false`, `eviction=false`, production만 연결, `--no-env-pull`로 준비했다. CLI가 최초 Marketplace 약관 동의를 요구하여 리소스는 아직 생성되지 않았다. 사용자에게 Vercel 로그인·약관 직접 동의를 요청했다.
- 카카오 재조회: 선행 migration 3개만 적용, Edge Function 없음. 보안 advisor는 기존 leaked password protection 경고 1개이며 이번 신규 결함으로 표시하지 않는다. 카카오 migration·앱 플래그·DB 플래그·웹훅은 아직 변경하지 않았다.
- 다음 행동: Upstash 약관 동의 확인 → 동일 무료 설정으로 생성·연결·2차 배포 검증 → 카카오 순서. `.claude/launch.json`은 보존. 이 절의 운영 기록은 로컬 문서 갱신이며 추가 커밋·push는 아직 하지 않았다.

## 2026-10-26 Claude Code — 대화를 받아 주는 답장 (C0, 로컬 커밋)

- 사용자 결정(D07 갱신): 과한 격려·훈계·코칭은 하지 않되, 대화를 받아 주는 UX가 필요하다. 기준 HEAD `24d2636`(Codex 커밋), `origin/main`·production `67a33f5`.
- 구현: Jev가 기록이 아니라고 본 문장(`other`, 먹지 않은 언급, 추천 질문)만 [smallTalk](../src/application/smallTalk.ts)가 읽는다. 음식 질문("떡볶이 칼로리 높아?", "치킨 먹어도 돼?", "삼겹살 먹고 싶다")은 질문 단서 앞부분을 데이터셋으로 조회해 kcal와 오늘 남은 양을 답한다. 인사·고마움·배고픔·배부름은 짧게 받아 준다. 단서가 없으면("빵 터졌네") 음식 정보를 붙이지 않고 기존 한 줄을 쓴다. 저장·수정·삭제 경로와 Jev 호출 수는 바뀌지 않는다. [chatPipeline](../src/application/chatPipeline.ts), [replyText](../src/components/replyText.ts) `describeTalk`.
- 검증: typecheck·lint 통과, 67개 파일 1,711개 테스트 통과(새 37개), build 통과, coverage 85.9%·silent 0/0 불변. 3210 production 빌드에서 실제 Jev로 7문장 확인(인사·떡볶이 질문·치킨 추천 질문·고마워·배고파·빵 터졌네·배불러), 식사 기록 생성 없음, 서버 오류 없음.
- 사용자가 답장 문구를 확인했고(2026-10-26) 승인에 따라 `24d2636` 위에 로컬 커밋했다. **push 안 함** — `origin/main`·production은 `67a33f5`, 로컬이 6개 커밋 앞선다. `.claude/launch.json`은 계속 미추적. 엉뚱한 말을 음식으로 읽어 묻는 문제(coverage `spurious_ask` 19건)는 이 변경 범위 밖이다(C1 이후).

## 2026-10-26 Codex 인계 점검 최신 결과

### 로컬 커밋 인계

- 사용자 승인으로 `83bdbc0` 위에 백업 보관 보강·검사·격리 복원 도구와 운영 문서 총 8개를 하나의 로컬 커밋으로 묶는다. 이 절이 포함된 커밋이 해당 작업 단위다. 기존 `.claude/launch.json`은 제외한다. 아래 미커밋 설명은 당시 경과다.
- 검증 근거: 보관 검사 8개, 실제 격리 복원 및 내용 일치·RLS 검사, lint, 문서 링크와 diff 확인 완료. 커밋 단계에서는 코드 변경이 없어 같은 검사를 반복하지 않았다.
- push·배포·스케줄러 등록은 승인 범위에 없으며 실행하지 않는다. 대화 UX·Jev 세분화는 전달된 제안일 뿐 구현·계획 변경에 포함하지 않았다. 다음 단계는 운영 체크리스트의 남은 승인과 실행이다.

### Claude Code 후속 검토 반영

- 사용자가 전달한 검토 4건을 [운영 체크리스트](product/operations-todo-2026-10-26.md)에 반영했다: 기본 앱 배포와 A1 실계정 확인 → Upstash → 카카오 순서의 계획안, 단계별 직전 배포 기록, Windows 일일 정리 등록안, DB 비밀번호 재설정 사실, 실제 Upstash 리전과 처리방침 일치 확인. 검토 전달을 운영 실행 승인으로 해석하지 않았다.
- PC 미가동 시 다음 실행하는 설정도 이미 지난 90일 기한을 소급해서 보장하지 못한다. 스케줄러는 아직 등록하지 않았다. Claude의 보관 검사 8개 통과는 전달받은 독립 검토 결과이며 이번 실행 결과는 아니다.
- 이번 후속은 문서만 수정했다. diff·내용·로컬 링크를 확인하고 앱 검증은 생략했다. HEAD `83bdbc0`, 기존 로컬 변경 보존, 커밋·push·배포 없음.

### 후속: 첫 백업과 격리 복원 완료

- 사용자 실행으로 `calories-account-20261026T082704Z.sql.gpg` 생성(6,068 bytes, 17:27 KST). Codex가 실제 파일·복호화·로컬 복원을 확인했다. 아래 첫 백업 대기 기록은 이 결과로 대체한다.
- [복원 절차와 범위](account-backup.md#격리-복원-확인-2026-10-26-완료): 네트워크/공개 포트 없는 PostgreSQL 17 tmpfs 컨테이너에서 공식 Auth migration 76개와 운영 적용 앱 migration 3개로 스키마를 준비한 뒤 원본 덤프를 복원했다. 네 테이블 전 열 내용 일치, 외래 키·계정별 RLS·타 계정 수정 차단·익명 읽기 거부 통과. 평문 파일·개인정보 로그 없음. 임시 DB·컨테이너 삭제 확인, 암호화 백업 보존.
- [재현 도구](../scripts/ops/verify-account-backup.mjs)를 추가했다. 운영 DB는 이 복원 작업 중 조회하거나 변경하지 않았다. 실제 OAuth·Supabase cron·전체 호스팅 서비스 복구는 미검증이다.
- 다음: 백업 만료 정리 환경 확정, Upstash·카카오 운영 적용 및 배포 승인 범위 확인. 첫 백업·로컬 데이터 복원은 완료이며 최대 90일 보관 운영은 아직 미완료다. 커밋·push 없음. 앱 코드를 바꾸지 않아 앱 전체 테스트·빌드는 재실행하지 않고 실제 복원 검사·lint·diff/문서 링크로 검증한다.

### 이전 점검 경과

- 사용자 요청: Wiki 파악 → 첨부 Claude 작업 내역 확인 → 잔업 목록화와 진행. [운영 잔업 체크리스트](product/operations-todo-2026-10-26.md)에 완료·대기 조건을 정리했다. 아래 기존 본문과 충돌하면 이 점검을 우선한다.
- 실제 시작 상태: `main` HEAD `83bdbc0`, 로컬 `origin/main` `67a33f5`, 기존 미추적 `.claude/launch.json`만 있음. 이번 변경은 미커밋이며 push·운영 변경은 하지 않았다.
- 직접 운영 조회: Supabase 선행 migration 3개와 pg_cron 확인, 복구/정책 테이블 없음, Edge Function 없음. Vercel `ACCOUNT_ENABLED=on`, 복구·Upstash 환경변수 없음, 연결 리소스 없음, 운영 alias는 기존 `dpl_BfCvZwnGyijeF7xjqSh627wfrvAF` Ready 배포를 유지한다.
- 직접 재검증: PGlite 0.5.8 SQL 14개, 앱 테스트 66파일·1,674개, typecheck·lint·production build 통과. 실제 로그인·복원·cron·Jev 과금 검증은 미실행이다.
- 수정: 카카오 적용 절차에 누락된 DB 활성화 단계를 복원하고 웹훅을 마지막으로 이동했다. 백업 스크립트에 날짜 정리(`--prune-only`, 일일 실행 시 89일 기준), 최대 3개 제한, dry run 무변경을 추가했다. 임시 fixture 검사 8개 통과. 일일 정리는 아직 등록하지 않았다.
- 미완료/다음 행동: pg_dump 또는 Docker 준비, 운영자 로컬 DB 접속 정보·백업 암호 및 보관/만료 정리 환경 확정 → 첫 백업·격리 복원 → Upstash·카카오 운영 적용 및 배포 승인 범위 확인 → 실제 계정 검증. PC가 꺼지면 최대 90일 백업 보관을 보장하지 못한다. 반복 사용 B는 이 순서 뒤다.
- Wiki 브리프는 10월 18~25일 기준 off·미커밋 정보를 포함해 현재 정본보다 오래됐다. 이를 운영 상태로 재사용하지 않는다.
- Wiki 제안 `FND-20261026-calories-operations-recheck-20261026`은 승인 대기로 기록했다. 제안 도구가 누락한 필수 `class: sync`를 해당 제안에만 보완했고 검증 오류 0·기존/현재 미커밋 문서 경고 5를 확인했다.
- 사용자 후속 답: 첫 백업을 위한 로컬 준비 방법 안내 요청. Git Bash·Docker Desktop, Session pooler URI와 gpg 암호를 로컬에서 입력하도록 안내한다. 운영 PostgreSQL 버전은 직접 조회한 17.11이므로 스크립트의 postgres:17 덤프 클라이언트와 주 버전이 같다. 실제 비밀 입력·백업 실행은 아직 하지 않았다.

## 1. 이번 인계의 기준과 확인 범위

- 확인한 브랜치: `main`, 코드 기준 HEAD: `67a33f5` (2026-10-13, 음식의 모호한 양·단위·대표 음식·재료 표현 개선). 문서 정비 커밋 전 기준이다. 다음 작업자는 실제 HEAD와 diff를 다시 확인한다.
- 시작 시 미추적 파일: `.claude/launch.json`. 기존 로컬 설정으로 이번 문서 정비 대상에서 제외했다. 새 세션의 working tree가 clean이라고 가정하지 않는다.
- 이번 작업 변경: STATE·DECISIONS 신설, AGENTS·CLAUDE·README와 기존 문서 연결 등 Markdown 14개 파일 정비. 당시 커밋·push는 하지 않았다.
- 2026-10-26: 10월 18일 문서 정비와 10월 26일 변경(IMPROVEMENT 신설, 운영·검증 재확인, D06 갱신)을 사용자 승인으로 `67a33f5` 위에 문서 커밋 하나로 로컬 커밋했다. **push하지 않았다** — `origin/main`과 production은 `67a33f5`다. `.claude/launch.json`은 커밋에서 제외해 미추적으로 남겼다(T02).
- 2026-10-18 확인: 로컬 코드·Git 기록·기존 인수인계와 Claude 프로젝트 메모 및 관련 10월 6·7·13일 대화를 대조했다. 개인 기록 없이도 이어갈 수 있도록 필요한 결정과 상태만 이 문서들에 옮겼다.
- 이번에는 운영 서비스·환경 변수·DB 적용 상태를 조회하지 않았다. 아래의 운영 상태는 마지막 기록이며 현재 확인 결과가 아니다.

## 2. 구현된 기능과 관련 코드

### 음식 기록

- 자연어 추가·수정·삭제, 삭제 되돌리기, 사용자가 말한 kcal, 여러 음식·분수·포장제품 일부를 지원한다. 데이터셋은 455개 항목 기준이며 모든 브랜드·용량을 지원하는 것은 아니다.
- 최근 변경: `d2fda77` 알려진 음식의 불확실한 양을 추정 기록, `50f9c5b` 계산 목표 저장 후 수동 입력창 닫기, `67a33f5` 조금/많이·입/젓가락/점/가닥/국자·밥/샐러드 대표값·재료 표현 처리.
- [chatPipeline](../src/application/chatPipeline.ts)의 add 경로는 섭취 여부 후보 필터 뒤에 `recordEstimates`를 적용한다. 양 추정 원칙이 모든 입력의 무조건 자동 저장을 뜻하지는 않는다. 띄어쓰기 나열·복합 수정에는 확인 단계가 남아 있다.
- 진입 코드: [addFood](../src/application/addFood.ts), [quantity](../src/ai/nutrition/quantity.ts), [servingReferences](../src/ai/nutrition/servingReferences.ts), [replyText](../src/components/replyText.ts).

### 대화·기록·화면

- `da4aae4`: 로컬 대화 보관, 삭제 메타데이터, 목표 설정 시각. 기존 익명 저장 키의 모양을 유지하며 별도 키를 사용한다.
- 대화는 KST 오늘과 이전 29일만 보관한다. 식사와 목표는 이 정리 대상이 아니다. [conversation](../src/domain/conversation.ts), [로컬 대화 저장소](../src/infrastructure/localStorageConversationRepository.ts), [storage](../src/infrastructure/storage.ts) 참조.
- 대화와 식사 연결·원문 표시, 오늘 화면과 대화 내역 분리, 메뉴 drawer, 개인 연속·누적 기록이 구현되어 있다. [TodayScreen](../src/components/TodayScreen.tsx), [HistoryScreen](../src/components/HistoryScreen.tsx), [recordConsistency](../src/domain/recordConsistency.ts) 참조.
- 월간 챌린지는 계산 함수와 준비 중 화면만 있다. [ChallengeScreen](../src/components/ChallengeScreen.tsx)은 참여 신청·순위 집계를 하지 않는다고 명시한다. 실제 서비스 출시로 보고하지 않는다.
- `86cd255`: 같은 음식을 다시 보고하면 추가 섭취로 취급한다. 반복 입력을 임의로 중복 제거하지 않는다.

### 계정·요청 제한

- `22845aa`: 요청 제한·Jev 일간 시도 상한. [serverUsageLimits](../src/infrastructure/serverUsageLimits.ts)는 프로세스 메모리 구현이다. 인스턴스 간 공유되지 않으므로 서비스 전체 과금 상한 보장이 아니다.
- `933273b` 이후: 선택 로그인, 동의한 계정 기록 저장·합치기·내보내기·삭제, 프로필 별도 동의, 계정 전환·revision 보호 코드가 있다. [accountMerge](../src/application/accountMerge.ts), [AccountScreen](../src/components/AccountScreen.tsx), [운영 메모](account-operations-2026-10-07.md) 참조.
- **2026-10-26 로컬 커밋 `3d4eec4`, push·배포 안 함:** 로그인 상태의 한 턴(수정·추가·대화)을 `batch` 변경 하나로 저장하도록 바꿨다. 서버는 같은 `mutateAccountData`로 순서대로 적용하고 revision을 한 번만 올린다. 실패하면 아무것도 저장되지 않는다. 브라우저는 턴 동안 캐시에 적용해 두었다가 턴 끝에 보내고, 실패하면 다시 읽고 실패 답장으로 바꾼다. 로그인하지 않은 로컬 저장과 턴 밖의 쓰기(목표 편집 등)는 그대로다. [accountMutation](../src/application/accountMutation.ts), [remoteRepositories](../src/infrastructure/remoteRepositories.ts), [TodayScreen](../src/components/TodayScreen.tsx) `runTurn`.
- **2026-10-26 로컬 커밋·미배포 — 사용자 결정 반영:** [개인정보처리방침](../src/app/privacy/page.tsx)을 9개 절과 수령자별 국외 이전 고지로 보완했다. Supabase 연락처·처리 국가, Upstash 항목(공유 제한 사용 시만), 백업 보관 90일(계정 기능 켜짐 시만)을 넣었다. `privacyPage.test.ts`가 기능별 표시 조건을 검사한다. 시행일(`EFFECTIVE_DATE`)은 게시하는 날로 바꾼다.
- **2026-10-26 로컬 커밋·운영 미연결:** 공유 요청 제한 [upstashRateLimiter](../src/infrastructure/upstashRateLimiter.ts). `RATE_LIMIT_STORE=upstash`와 자격 증명이 있을 때만 쓰고, 실패하면 메모리 제한으로 대신한다. 기본값은 지금과 같은 `memory`다. 운영 연결은 [절차](account-operations-2026-10-07.md#공유-요청-제한-upstash-운영-연결-절차-2026-10-26-코드-준비-미연결).
- **2026-10-26 로컬 커밋:** 월 1회 계정 DB 백업 [스크립트](../scripts/ops/backup-account-db.sh)와 [절차](account-backup.md). 실제 백업은 아직 하지 않았다.
- 카카오 해제 7일 유예는 사용자가 적용을 결정했다(2026-10-26). 운영 적용 [절차](account-operations-2026-10-07.md#카카오-연결-해제-운영-적용-절차-2026-10-26-준비-실행-전)만 준비했고 실행하지 않았다.
- 카카오 외부 연결 해제 후 7일 복구 유예는 코드와 격리 SQL 검증이 준비된 상태다. 운영 migration·Edge Function·웹훅 활성화 완료로 취급하지 않는다.

## 3. 배포·활성화: 마지막 기록과 미확인 사항

- **2026-10-26 재확인(읽기만):** `origin/main` = 로컬 HEAD = `67a33f5`. Vercel production 최신 배포는 `dpl_BfCvZwnGyijeF7xjqSh627wfrvAF`(2026-10-13 14:45 KST, Ready, commit `67a33f5`)이며 `how-much-calories-left.vercel.app` alias가 이 배포를 가리킨다. 직전 production 배포는 `dpl_Ag1J53jytfHtwoVS8hm17NtfA87J`(`7d66316`)다. 음식 기능 smoke는 이번에 다시 하지 않았다.
- **계정 기능은 운영에서 켜져 있다(의도됨).** 2026-10-26 `vercel env ls production`에서 `ACCOUNT_ENABLED=on`(CLI 표시 경과 19일), 운영 `/api/account`는 `configured: true`, 제공자 google·kakao, `recoveryEnabled: false`를 반환했다. 같은 날 사용자가 **켠 것은 의도한 것이며 유지한다**고 확인했다([DECISIONS D06](DECISIONS.md#d06-구현과-계정-기능-공개운영-활성화를-구분한다)). 켠 정확한 날짜는 기록이 없다. 계정 운영 메모의 `off` 기록은 당시 기준이다.
- `ACCOUNT_RECOVERY_ENABLED`는 production에 설정되지 않아 기본값 off다. 카카오 연결 해제·7일 복구 유예의 migration·Edge Function·웹훅도 운영 미적용 상태로 남아 있다(재조회는 env만 함).
- 켜진 상태에서 남은 확인: Google 실제 가입→로그아웃 기록 없음, 개인정보처리방침의 위탁·국외 이전·보존기간 미확정, 앱 별도 백업 없음, 요청 제한은 인스턴스별 메모리. 이제 "공개 전 조건"이 아니라 **운영 중 해결할 위험**이다([IMPROVEMENT](IMPROVEMENT.md) T30~T35).
- 실제 카카오 가입·조회·로그아웃 성공 기록이 운영 메모에 있으나, 같은 문서 말미에는 실제 Google·카카오 가입 미완료라는 설명도 남아 있다. 카카오 일부 검증 근거는 있으나 전체 공개 준비 완료로 결론 내리지 않는다. Google 실제 로그인과 카카오 해제·복구는 재확인 대상으로 남긴다.
- 공급자 보관·처리 조건, 가입 연령 조건의 적용 범위, 운영 백업·복구 방식, 공유 요청 카운터, 턴 전체의 부분 저장 가능성은 [공개 전 운영 확인](account-operations-2026-10-07.md#공개-전-남은-운영-확인)을 기준으로 다시 확인한다. 문서 정비가 운영 활성화 승인은 아니다.

## 4. 검증 근거

- 2026-10-13 Claude 완료 보고: typecheck·lint·단위 테스트 1,648개 통과, coverage 85.9%, silent wrong/drop 0/0. 밥·샐러드 4건의 기대 동작을 대표 음식 기록으로 변경했다고 보고했다.
- **2026-10-26 `67a33f5` 재실행(Claude Code):** typecheck·lint 통과, 단위 테스트 63개 파일 1,648개 통과, production build 통과. `eval:food-coverage` 데이터셋 455개·207건 중 정확 177/206(85.9%), Jev guard 가정 173/194(89.2%), silent wrong/drop 0/0, 불필요한 질문 31. `eval:food-modifiers` 66/66, 경계 13/16(기존 한계 3). 10월 13일 보고 수치와 같다. fixture·기준선은 바꾸지 않았다. `eval:food-judgment`(Jev 과금)와 브라우저·운영 smoke는 실행하지 않았다.
- **2026-10-26 A3·A4 준비 후(커밋 전 실행):** typecheck·lint 통과, 66개 파일 1,674개 테스트 통과(Upstash 제한 11개·처리방침 표시 조건 5개 추가), build 통과, coverage 85.9%·silent 0/0 불변. 3210 production 빌드에서 기본(memory) 설정으로 음식 기록 1건과 서버 오류 없음을 확인했다. 백업 스크립트는 가짜 `pg_dump`와 테스트 암호로 암호화·복호화·보관 개수를 확인했다(운영 DB 미연결). 카카오 SQL 격리 검사(PGlite)는 설치본이 지워져 재실행하지 못했고, 관련 단위 테스트 24개는 통과했다.
- **2026-10-26 A1·A2 변경 후(커밋 전 실행):** typecheck·lint 통과, 64개 파일 1,658개 테스트 통과(새 batch·턴 버퍼 테스트 10개), production build 통과, `eval:food-coverage` 85.9%·silent 0/0 불변. 3210 포트 production 빌드에서 비로그인 추가·정정·삭제·되돌리기와 `/privacy`(375px 가로 넘침 없음)를 확인했다. **로그인 상태의 턴 저장은 실제 계정이 필요해 브라우저로 확인하지 못했다**(단위 테스트만).
- 위 수치는 당시 보고이며 이번 실행 결과가 아니다. coverage는 고정 평가셋의 동작 평가이지 실사용 정확도나 영양값 정확도 보장이 아니다. [평가 기준선](../fixtures/food-input-coverage.baseline.json), [평가 입력](../fixtures/food-input-coverage.json) 참조.
- 2026-10-18 문서 정비 검증: 14개 문서의 내부 링크·제목 링크 87개 유효, Next.js 생성 블록 원문 보존, `git diff --check` 통과. 로컬 데이터셋 455개 항목도 확인했다. 앱 코드를 바꾸지 않아 typecheck·lint·test·build 및 브라우저·운영 검증은 재실행하지 않았다.
- 코드 변경 시 기본 검증 명령: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. 영향에 맞는 날짜 경계·음식 coverage·브라우저 확인을 추가한다. 실제 Jev 평가·식약처 동기화는 네트워크·과금 영향이 있어 일반 테스트와 구분한다. 테스트 서버는 사용자 3000 포트와 분리한다.

## 5. 다음 작업

- **2026-10-26 진행 중:** 사용자 지시로 [실행 계획](product/execution-plan-2026-10-26.md)(계정 위험 → 반복 사용 → 입력 품질)을 세웠다. Phase A1(턴 단위 원자 저장), A2(처리방침·결정 메모), 사용자 결정 반영(Google 점검 성공, 카카오 유예 적용, Upstash, 월 백업, 처리방침 권장안, 민감정보 아님), A3(공유 제한 코드), A4 준비(백업 스크립트, 카카오 적용 절차)를 마쳤다. **운영 적용은 사용자가 직접 한다(2026-10-26 사용자 지시):** 첫 백업, Upstash 생성·연결, 카카오 migration·함수·웹훅. 끝나면 사용자가 알려 준다. 그 뒤 `ACCOUNT_RECOVERY_ENABLED`·`RATE_LIMIT_STORE` 전환과 영역 B(반복 사용)를 이어 간다. 커밋(모두 사용자 승인, push 안 함 — `origin/main`·production은 `67a33f5`): A1은 `3d4eec4`, A3·백업 스크립트·처리방침은 그 위의 코드 커밋, 이 문서들은 그다음 문서 커밋이다. `.claude/launch.json`(`verify-start` 3210 추가 포함)은 미추적으로 남겼다(T02).
- 이번 승인 범위인 공통 인수인계 정비는 완료했다. 앱 기능 추가·계정 활성화·배포는 포함하지 않았다. 다음 기능은 아직 선택하지 않았다.
- 제안 1: 실제 입력 실패 문장을 회귀 사례로 추가하고, 추정 기준 안내와 정정 흐름을 개선한다. 추정 단위·기본량의 실사용 적합성도 확인한다.
- 제안 2: 운영에서 켜진 계정 기능의 남은 위험(Google 실제 로그인 검증, 개인정보처리방침 항목, 백업, 공유 요청 제한, 카카오 해제·복구)을 해결한다. 2026-10-26부터 공개 전 조건이 아니라 운영 중 과제다.
- 제안 3: 스트릭·챌린지 확장 전 기록을 마치는 데 걸리는 부담과 반복 사용 효과를 확인한다.
- 2026-10-26: 위 제안과 피드백·계정 운영의 남은 항목을 [자가 발전 체크리스트와 할 일](IMPROVEMENT.md)로 정리했다(문서만 추가). 할 일은 모두 제안이며 다음 기능 선택을 대신하지 않는다.
- 주 작업 도구와 보조 검토 도구를 두는 것은 운영 제안이다. 특정 도구를 영구 담당으로 확정하거나 다른 도구의 구현을 금지하지 않는다.

## 6. 상세 자료 지도

- [DECISIONS](DECISIONS.md): 최신 제품·데이터·작업 원칙. 새 결정은 여기에 반영한다.
- [IMPROVEMENT](IMPROVEMENT.md): 실패 사례 → 회귀 → 측정 → 기록 루프의 체크리스트와 제안 할 일(T01~T41).
- [계정 운영 메모](account-operations-2026-10-07.md): 구현·검증·운영 미적용 항목의 상세 근거.
- [계정 준비 지시서](CODEX-HANDOFF-2026-10-07-account-prep.md), [계정 계획](product/account-and-sync-plan-2026-10-07.md): 당시 범위·결정의 근거. 이미 구현된 단계를 다시 시작하는 지시가 아니다.
- [피드백 요구사항](product/user-feedback-requirements.md), [10월 6일 반영 현황](product/user-feedback-status-2026-10-06.md): R01~R15의 원래 문제와 당시 상태. R07·R12·R14의 후속 구현은 위 §2를 우선 확인한다.
- [음식 입력 인수인계](HANDOFF-2026-10-01-food-input.md), [9월 27일 인수인계](CODEX-HANDOFF-2026-09-27.md), [초기 HANDOFF](HANDOFF.md): 과거 실험·결정·검증 기록. 이전 배포 ID를 현재 복구 대상으로 곧바로 사용하지 않는다.
- [아키텍처](architecture.md): 책임 경계와 초기 설계. 계정·추정 경로는 현재 코드와 이 문서를 함께 확인한다.

## 7. 다음 인계 때 갱신할 항목

기준 날짜·브랜치·커밋, 기존/신규 미커밋 변경, 완료 범위, 직접 실행한 검증과 미실행 이유, 운영에 실제 적용한 것, 남은 문제, 다음 행동을 짧게 갱신한다. 커밋 전에는 기준 HEAD와 미커밋 변경을 명시해 자기 커밋 해시를 미리 추측하지 않는다. 확정된 원칙 변경은 DECISIONS에 날짜와 근거를 남긴다. 개인 메모나 대화 이력만 갱신하고 인계를 끝내지 않는다.
