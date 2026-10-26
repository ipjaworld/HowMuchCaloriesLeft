# 현재 상태 — 공통 인수인계

최종 갱신: 2026-10-26 (KST) 운영 상태·검증 재확인 추가 (본문 정비는 2026-10-18) · Codex / Claude Code 공용

이 파일은 현재 작업의 진입점이다. 확정 원칙은 [DECISIONS](DECISIONS.md), 실행 규칙은 [AGENTS](../AGENTS.md)를 읽는다. 날짜별 문서는 과거 근거이며, 그 안의 상태·테스트 수·명령·승인 범위가 지금도 유효하다고 가정하지 않는다.

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
