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
- 최근 3개만 남기고 오래된 것을 지운다(`BACKUP_KEEP`). 위치는 `BACKUP_DIR`로 바꿀 수 있지만 저장소 안은 거부한다. 저장소가 공개라서다.
- 연결 문자열은 셸에만 넣는다. `.env.local`이나 저장소 파일에 저장하지 않는다.
- 미리 보기: `scripts/ops/backup-account-db.sh --dry-run`. 아무 데도 연결하지 않는다.
- 외장 디스크 사본을 원하면 같은 파일을 복사한다. 이미 암호화돼 있다.

## 복원 (미시험)

1. 새 Supabase 프로젝트를 만들고 `supabase/migrations/`를 순서대로 적용한다.
2. 복호화: `gpg --output restore.sql --decrypt calories-account-<시각>.sql.gpg`
3. 대상 DB에 적용: `psql "$TARGET_DB_URL" -f restore.sql`. auth 테이블이 먼저 들어가야 외래 키가 맞는다. 순서가 맞지 않으면 `--disable-triggers`로 다시 덤프하는 방안을 검토한다.
4. 끝나면 `restore.sql`을 지운다.

**아직 복원을 해 보지 않았다.** 첫 백업 뒤 별도 프로젝트에서 한 번 복원해 보고 이 절을 고친다.

## 검증 기록

- 2026-10-26: 가짜 `pg_dump`와 테스트 암호로 스크립트를 실행해 확인한 것 — 암호화 파일 생성, 복호화한 내용 일치, 3개 초과분 삭제, 저장소 내부 경로 거부, `SUPABASE_DB_URL` 없으면 중단. 실제 운영 DB에는 연결하지 않았다.
