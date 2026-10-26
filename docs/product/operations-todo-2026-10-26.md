# Claude 작업 인계 후 운영 잔업

기준: 2026-10-26 KST, Codex 직접 재확인. 로컬 `main` HEAD `83bdbc0`, 추적 중인 `origin/main` `67a33f5`. 기존 `.claude/launch.json`은 미추적 상태로 보존했다. 현재 요청은 첨부 작업 내역의 잔업 정리·진행이며, 과거 커밋·push 승인을 재사용하지 않는다.

## 완료

- [x] 후속 사용자 요청으로 첫 실제 백업(6,068 bytes)과 로컬 PostgreSQL 17 격리 복원 완료. 네 테이블 전체 백업 열 일치·외래 키·계정별 RLS 검증 통과, 임시 DB 삭제 확인. 운영 DB 접속 없음. 상세는 [백업 절차](../account-backup.md#격리-복원-확인-2026-10-26-완료).

- [x] Wiki studio·calories 브리프와 저장소 STATE·DECISIONS 대조. Wiki의 계정 off·미커밋 15건 요약은 10월 18~25일 기준으로 현재와 다르다.
- [x] Claude 로컬 커밋 4개 확인: `6f8b28b`, `3d4eec4`, `f80275e`, `83bdbc0`.
- [x] Supabase 읽기 전용 사전 확인: 선행 migration 3개·pg_cron 있음, 복구/정책 테이블 없음, Edge Function 없음.
- [x] Vercel 읽기 전용 확인: `ACCOUNT_ENABLED=on`; 복구·Upstash 관련 변수 없음; 연결 리소스 없음. 운영 alias는 Ready 배포 `dpl_BfCvZwnGyijeF7xjqSh627wfrvAF`(10월 13일)를 가리킴.
- [x] 임시 PGlite 0.5.8에서 카카오 SQL 14개 검사 통과. 앱 의존성·lockfile 변경 없음.
- [x] 기존 앱 전체 테스트 66파일·1,674개, typecheck, lint, production build 재검증 통과. 실사용 로그인·Jev 과금 검증은 포함하지 않음.
- [x] 카카오 절차 수정: 누락된 DB `enabled` 단계 복원, 앱 배포→DB 활성화→함수→웹훅 순서로 통일. DB off여도 RLS 변경은 적용됨을 명시.
- [x] 백업 보관 결함 수정: 개수만 제한하던 스크립트에 날짜 기준·`--prune-only`·최대 3개 제한 추가. 매일 실행 시 최대 90일을 지키도록 89일에 정리. dry run 디렉터리 생성 방지. 임시 파일 검사 8개 통과.

## 실행 순서와 남은 조건

2026-10-26 사용자 전달 Claude Code 검토를 반영한 **실행 계획안**이다. 전달된 검토는 커밋·push·운영 설정 변경·스케줄러 등록 승인을 뜻하지 않는다. 백업 보관 검사 8개 재통과는 Claude의 독립 재검증 보고로 구분한다.

| 순서 | 할 일 | 현재 상태와 필요한 것 |
| --- | --- | --- |
| 1 | 첫 암호화 백업, 별도 환경 복원 | **완료.** 사용자 백업 후 Codex가 네트워크 없는 PostgreSQL 17에 실제 복원·내용 일치·RLS 확인, 컨테이너 삭제. OAuth·호스팅 전체 서비스 복구는 별도 |
| 2 | 백업 만료 정리 운영 | **대기.** Windows 작업 스케줄러에 매일 실행·누락 시 다음 실행 가능 시점에 실행하도록 등록하는 안. 등록 전 사용자 확인. PC가 꺼진 동안 기한이 지나면 다음 실행으로 이미 발생한 초과 보관을 해소할 뿐, 최대 90일을 보장하지는 못함 |
| 3 | 1차 배포: 로컬 변경 커밋·main push | **미실행.** 기존 4개 커밋과 이번 변경 범위를 검토하고 현재 작업의 승인 필요. `ACCOUNT_ENABLED=on` 유지, `RATE_LIMIT_STORE` 미설정(memory), `ACCOUNT_RECOVERY_ENABLED=off`. 처리방침 시행일은 실제 게시일로 맞춤 |
| 4 | 1차 배포 검증: A1·처리방침 | **미실행.** 실제 로그인 계정에서 한 턴의 `POST /api/account/data`가 batch 요청 1회인지, revision 증가가 정확히 1인지, 새로고침 후 기록 유지와 `/privacy` 표시가 맞는지 확인 |
| 5 | 2차 배포: Upstash 연결·공유 제한 활성화 | **미생성·미배포.** 1차 검증 후 `upstash/upstash-kv`를 미국 동부에 생성, production만 연결, `.env.local` 자동 pull 금지. 가격·약관·요금 상한 확인 후 승인 범위에서 `RATE_LIMIT_STORE=upstash` 재배포. 키 생성·경고·처리방침 확인. 다른 리전이면 처리방침 문구도 함께 수정 |
| 6 | 3차 배포 준비: 카카오 migration·복구 앱 | **미적용.** 2차 검증 후 운영 승인 범위에서 migration 적용, 실제 Supabase fixture·advisor·기존 로그인 RLS 확인 후 `ACCOUNT_RECOVERY_ENABLED=on` 앱 배포. DB 정책 off여도 migration의 RLS 변경은 적용됨 |
| 7 | DB lifecycle 활성화·함수 배포·카카오 웹훅 | **미실행.** 앱 배포 확인 뒤 DB 활성화, JWT 검증 없는 함수의 KakaoAK 인증 확인, 웹훅 등록 순서 |
| 8 | 실제 계정 최종 검증 | **미실행.** 한 턴 revision 1회 증가·새로고침 유지, 카카오 연결 끊기·잠금·재동의·복구, Redis 키/경고 확인. 사용자 실제 인증 필요 |
| 9 | 반복 사용 개선 B1 | **후속.** 운영 잔업 완료 뒤 UX 설계안부터 진행. 이번에는 신규 제품 기능 구현으로 확대하지 않음 |

운영 SQL과 되돌리기 조건은 [계정 운영 메모](../account-operations-2026-10-07.md#카카오-연결-해제-운영-적용-절차-2026-10-26-준비-실행-전), 백업 준비는 [계정 백업](../account-backup.md)을 따른다. PGlite 통과는 실제 cron·OAuth·복원 성공이 아니다. 운영 변경은 이번 점검 중 수행하지 않았다.

- 각 배포 직전에 현재 production 배포 ID·commit·기능 설정을 조회하고 되돌릴 대상으로 기록한다. 마지막 직접 확인한 기준은 `dpl_BfCvZwnGyijeF7xjqSh627wfrvAF`다. 이를 이후 모든 단계의 고정 되돌리기 대상으로 쓰지 않는다. DB migration·유예 계정은 앱 배포 되돌리기만으로 복구되지 않는다.
- 일일 정리 등록안: 프로그램 `C:\Program Files\Git\bin\bash.exe`, 인자 `"D:/2026_project/HowMuchCaloriesLeft/scripts/ops/backup-account-db.sh" --prune-only`. 백업을 만든 동일 사용자로 실행하고 보관 경로·실행 결과를 확인한다. DB 접속 정보·백업 암호는 필요 없다. 아직 등록하지 않았다.
- 2026-10-26 DB 비밀번호 재설정은 사용자 완료 보고와 이후 백업 성공으로 기록했다. 기존 비밀번호를 쓰는 도구·직접 연결이 있다면 로컬에서 갱신해야 한다. 값은 저장소에 기록하지 않는다.

## 다음 담당자에게

첫 백업과 로컬 데이터 복원은 완료했다. 만료 정리 환경, 운영 적용·커밋·push 범위를 확인하고 2~8을 순서대로 완료한다. Google 로그인은 사용자의 이전 성공 보고가 있으며 이번 재검증으로 표시하지 않는다. 배포 커밋·기능별 활성화 결과를 STATE에 남긴 뒤 B1로 넘어간다.
