# 계정 DB 백업 — 운영자 월 1회

결정: 2026-10-26 [DECISIONS D06](DECISIONS.md#d06-구현과-계정-기능-공개운영-활성화를-구분한다)(권장안 ⓒ). 공개를 넓히면 유료 자동 백업으로 옮긴다. 처리방침은 "최근 3개(약 90일)만 보관"을 약속한다. 보관 개수를 바꾸면 [처리방침](../src/app/privacy/page.tsx)도 같이 바꾼다.

## 무엇이 들어가나

- `public.*`(계정 기록·계산기 프로필), `private.*`(복구 유예 상태 등), `auth.users`, `auth.identities`. 데이터만 들어가고 스키마는 migration으로 다시 만든다.
- 세션·로그는 넣지 않는다. 로그인 없이 쓰는 사용자의 기록은 각자 브라우저에만 있어서 백업 대상이 아니다.

## 준비 (한 번)

- PostgreSQL 17 클라이언트(`pg_dump`)를 설치하거나 Docker Desktop을 켠다. 스크립트는 `pg_dump`를 먼저 쓰고, 없으면 Docker의 `postgres:17` 이미지를 쓴다. 이미지는 첫 실행 때 내려받는다.
- Supabase 대시보드 → Connect → **Session pooler** 연결 문자열(5432)을 쓴다. 무료 플랜의 직접 연결은 IPv6 전용이다.
- 백업 암호는 비밀번호 관리자에 둔다. 잃어버리면 복원할 수 없다.

## 매월 실행

```bash
SUPABASE_DB_URL='postgresql://postgres.<project>:<password>@<pooler-host>:5432/postgres' scripts/ops/backup-account-db.sh
```

- 결과: `~/hetrich-backup/calories/calories-account-<UTC 시각>.sql.gpg`. gpg가 암호를 두 번 묻는다. 평문은 디스크에 남지 않는다.
- 최근 최대 3개만 남기고 오래된 것을 지운다(`BACKUP_KEEP`는 1~3만 허용). 파일명 UTC 시각 기준 89일 이상 된 사본도 지운다. 위치는 `BACKUP_DIR`로 바꿀 수 있지만 저장소 안은 거부한다. 저장소가 공개라서다.
- 연결 문자열은 셸에만 넣는다. `.env.local`이나 저장소 파일에 저장하지 않는다.
- 미리 보기: `scripts/ops/backup-account-db.sh --dry-run`. 아무 데도 연결하지 않는다.
- 외장 디스크 사본을 원하면 같은 파일을 복사한다. 이미 암호화돼 있다.

## 백업을 건너뛴 달에도 보관 기한 지키기

기존 스크립트의 개수 제한만으로는 처리방침의 최대 90일을 지킬 수 없다. 2026-10-26 보강한 `--prune-only`는 DB 접속·암호 없이 날짜와 개수 기준으로 정리한다. 파일 복사로 바뀔 수 있는 수정 시각 대신 파일명 UTC 생성 시각을 쓴다.

```bash
scripts/ops/backup-account-db.sh --prune-only --dry-run
scripts/ops/backup-account-db.sh --prune-only
```

- 백업 보관 장치에서 **매일 실행하고 성공 여부를 확인**해야 한다. 89일 기준은 매일 실행 사이 24시간의 여유다. PC가 꺼져 있거나 디스크가 분리돼 있으면 최대 90일은 보장되지 않는다.
- **정기 실행은 아직 등록하지 않았다.** 첫 백업 전 보관 위치와 상시 실행할 환경을 정한다. 외장 사본에도 같은 기한을 적용한다. 이 조건을 갖추기 전에는 처리방침의 백업 보관 약속을 운영에서 충족했다고 보고하지 않는다.
- Windows에서는 Git Bash의 `bash.exe`를 사용한다. `C:\Windows\System32\bash.exe`(WSL)와 구분한다. `--dry-run`과 정리 전용 실행은 없는 디렉터리를 만들지 않는다.

## 격리 복원 확인 (2026-10-26 완료)

첫 실제 백업 `calories-account-20261026T082704Z.sql.gpg`(6,068 bytes, 17:27 KST)를 로컬 Docker PostgreSQL 17에서 복원했다. 운영 DB 연결·조회·변경 없이 수행했다.

- 인증 스키마: [Supabase Auth 공식 소스](https://github.com/supabase/auth/tree/c3348e8f1cb31454e9783e4eb9eab1e71ad9652f/migrations)의 고정 commit `c3348e8f1cb31454e9783e4eb9eab1e71ad9652f`, 76개 migration. 운영의 정확한 Auth 버전과 동일하다는 검증은 아니다.
- 앱 스키마: 백업 시 운영에 적용된 앞의 3개 migration만 적용. 카카오 유예 migration은 운영 미적용이므로 넣지 않았다. `cron.schedule`은 등록용 stub으로 대체해 정기 작업이 복원 데이터를 변경하지 않도록 했다.
- 격리: 로컬 Docker 소켓만 허용, 네트워크 `none`, 공개 포트 없음, DB 저장소 tmpfs, 컨테이너 로그 비활성화. GPG 복호화 SQL과 재조회 결과는 프로세스 메모리/파이프로만 전달하고 평문 파일·개인정보 로그를 만들지 않았다.
- 복원: 원본 덤프를 단일 트랜잭션과 `ON_ERROR_STOP`으로 적용했다. 제약조건·외래 키를 끄지 않았다.
- 검증: `auth.users` 2행, `auth.identities` 2행, `account_data` 2행, `account_profiles` 1행. 모든 백업 열을 PostgreSQL COPY 형식으로 재출력해 행 순서 정규화 후 메모리 내 SHA-256으로 원본과 비교했고 모두 일치했다. 고아 레코드 0, 계정별 RLS 조회·타 계정 UPDATE 차단·익명 읽기 거부 확인. 세션은 백업 정책상 포함되지 않는다.
- 정리: 이 검사용 컨테이너와 임시 DB를 삭제하고 컨테이너 부재를 확인했다. 원본 암호화 파일은 보존했다.

재현 도구: [verify-account-backup.mjs](../scripts/ops/verify-account-backup.mjs). 위 commit의 공식 Auth migration 폴더를 별도 임시 디렉터리에 내려받은 뒤 실행한다. 이번에 사용한 `postgres:17` 이미지 digest는 스크립트에 고정돼 있으며 로컬에 있어야 한다. GPG 캐시에 암호가 없으면 로컬에서 암호 입력을 먼저 완료해야 한다. 암호를 명령 인자·채팅에 넣지 않는다.

```text
node scripts/ops/verify-account-backup.mjs <암호화-백업-절대경로> <공식-Auth-migrations-폴더>
```

이 도구는 **이번 4개 테이블 백업용**이다. 카카오 유예 기능을 운영에 적용하면 private 테이블·스키마 구성과 복원 검증 도구를 함께 확장해야 한다. 모든 migration을 무조건 적용하는 과거 절차는 사용하지 않는다.

**확인 범위:** DB 데이터 복원과 접근 제한까지 완료. 새 호스팅 Supabase 프로젝트로의 전체 서비스 복구, 실제 OAuth 재로그인, 실제 pg_cron·Edge Function·환경변수 복원은 별도 검증이다. 데이터 전용 백업이므로 앱 migration 및 인증 스키마 준비가 필요하다.

## 검증 기록

- 2026-10-26 후속: 사용자가 첫 실제 암호화 백업 완료, Codex가 파일 크기와 복호화 성공을 직접 확인한 뒤 위 격리 복원 검증을 완료했다. 아래 과거 항목의 실제 덤프·복원 미실행 상태를 대체한다.

- 2026-10-26: 가짜 `pg_dump`와 테스트 암호로 스크립트를 실행해 확인한 것 — 암호화 파일 생성, 복호화한 내용 일치, 3개 초과분 삭제, 저장소 내부 경로 거부, `SUPABASE_DB_URL` 없으면 중단. 실제 운영 DB에는 연결하지 않았다.
- 2026-10-26 Codex 재검증: `node scripts/ops/backup-retention.test.mjs` 8개 통과. 날짜·개수 정리, dry run 무변경, 빈 디렉터리, 저장소 경로 거부, 4개 이상 보관 거부, DB URL 누락 시 기존 파일 보존을 임시 fixture로 확인했다. 실제 덤프·복원은 여전히 미실행이다.
