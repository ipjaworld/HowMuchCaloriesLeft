# 선택 계정 기능 운영 메모 — 2026-10-07

## 공개 상태

1·2단계는 `22845aa`까지 main에 push했다. Vercel production의 `RATE_LIMIT_SECRET`은 암호학적 난수 32바이트(64자리 hex)로 설정했다. 이 값은 요청 횟수가 아니라 IP/계정 식별자를 HMAC하는 비밀키다. 제한 기본값은 chat 분당 20/하루 200, resolve 분당 60/하루 600, Jev 시도 하루 2,000이다. 계정 제한은 IP 제한에 추가된다.

3~7단계 코드는 공개 스위치 뒤에 둔다. `ACCOUNT_ENABLED=off`에서는 기존 익명 화면과 저장 키가 유지된다. OAuth 제공자 연결과 실제 로그인 검증, 아래 공개 전 확인을 마치기 전 `on`으로 바꾸지 않는다. 테스트 모드 Google 앱을 일반 공개 완료로 간주하지 않는다.

## 전용 리소스

- Supabase: Minjaekoon's Org / HowMuchCaloriesLeft / `juqriefbvymiuespfslj` / 서울 `ap-northeast-2`, 생성 시 월 비용 $0 확인.
- Google Cloud: HowMuchCaloriesLeft / `gold-pod-510903-t6`. 로그인 표시 이름: 오늘 얼마 먹어도 돼?. 웹 클라이언트: HowMuchCaloriesLeft Supabase.
- Kakao: 오늘 얼마 먹어도 돼? / 앱 ID `1599886`. 닉네임 선택 동의, 이메일 미제공 허용. 기존 HIS 앱과 별개다.
- Supabase에서 Google·Kakao를 활성화하고 사용하지 않는 Email 제공자는 비활성화했다. Google nonce 검증은 유지한다.
- 공급자 콜백: `https://juqriefbvymiuespfslj.supabase.co/auth/v1/callback`.
- 앱 콜백: `https://how-much-calories-left.vercel.app/api/auth/callback`.
- 로컬 검증 때만 `http://localhost:3202/api/auth/callback`을 허용한다. 검증 종료 후 삭제한다.
- 기존 HETRICH 프로젝트/클라이언트와 HIS 앱의 이름·권한·리디렉션은 변경하지 않았다.

## 구현과 데이터 경계

- Supabase SSR의 PKCE와 HttpOnly 쿠키를 사용한다. 공개 페이지에 proxy를 추가하지 않고 API에서 `getUser()`로 검증한다. 인증 응답은 `private, no-store`다.
- 쓰기 Origin을 APP_ORIGIN에 고정하고, 클라이언트가 연 계정과 현재 세션의 계정이 다른 경우 409로 막는다. DB에서도 `auth.uid() = user_id` RLS로 소유권을 제한한다.
- `account_data`는 계정별 크기 제한 문서이며 revision 조건으로 비교 후 갱신한다. 합치기는 한 번의 DB 쓰기로 원자적으로 완료한다. 동시 변경은 덮어쓰지 않고 409로 알린다.
- 기존 식사·목표·대화는 명시적 합치기 동의 후만 전송한다. 중복 ID는 수정 시각, 삭제 표시는 삭제 시각, 목표는 설정 시각을 비교한다. 시각이 같은 기록은 서버 값, 삭제와 수정이 같으면 삭제가 우선한다. 명시적 되돌리기는 삭제 시각보다 늦은 수정 시각을 갖는다.
- 로그인 기록은 메모리에만 캐시하고 localStorage에 복사하지 않는다. 오프라인 쓰기 큐는 없다. 기존 기기의 원본은 합친 뒤에도 남긴다.
- 계산기 입력은 기본 로컬이다. 별도 동의 후 `account_profiles`에 보관한다. 철회하면 해당 행을 삭제하고 기존 목표 숫자는 유지한다. 판단 API/기록 합치기에 신체정보가 섞이지 않도록 구조 검사와 행동 검사를 함께 둔다.
- JSON 내보내기는 계정 기록과 선택 보관한 계산기 정보를 포함한다. 기기 기록 내보내기는 식사·목표·대화·삭제 메타를 포함한다.
- 계정 삭제 RPC는 요청자의 활성 세션을 확인하고 본인의 auth.users 행만 삭제한다. FK cascade로 기록/프로필/세션이 제거된다. 기기 원본과 외부 제공자의 계정 자체는 삭제하지 않는다.
- 대화는 KST 오늘과 이전 29일만 조회/합치기 때 유지하고, pg_cron이 매일 15:00 UTC에 물리 정리한다. 잘못된 시각·미래 시각도 정리하며 식사·목표는 삭제하지 않는다.

## 검증

- `pnpm typecheck`, `pnpm lint`, `pnpm test`: 58개 파일 1,564개 테스트 통과(계정 작업 전 52개 파일 1,518개). `pnpm build`는 제한된 네트워크의 Google Fonts 다운로드 실패 후 네트워크 허용 재실행에서 통과했다.
- 3202 브라우저: 동의 체크 없는 로그인 제출 차단, 공개 스위치 off의 준비 중 화면, on의 선택 로그인 화면, 비로그인 목표 2,000 + 커피 9 kcal 기록 → 1,991 kcal 남음 → 히스토리 원문/대화/연결 기록 표시를 확인했다. 콘솔 오류/경고 없음.
- Supabase 보안 advisor: 지적 사항 없음.
- 실제 DB의 트랜잭션 내 가상 사용자 두 명으로 RLS, 다른 계정 갱신 거절, revision 경쟁, 계정 삭제 cascade, 익명 SELECT 차단, 잘못된/만료/미래 대화 정리를 확인하고 모두 rollback했다.
- Vitest: 합치기 멱등성, 삭제/되돌리기, 오래된 목표, 30일 경계, 외부 Origin, 세션 없음, 계정 전환, 명시적 삭제 확인, 프로필 별도 동의/철회 경쟁, 네트워크 실패 시 로컬 대체 저장 금지, 계정별 추가 제한을 검증한다.
- 실제 AI 과금 부하 테스트는 하지 않는다. 별도 3202 포트 검증은 TypeSafe 키를 비워 실행한다. 사용자의 3000/production localStorage는 읽거나 변경하지 않는다.

## 공개 전 남은 운영 확인

1. Google·카카오 실제 가입 → 콜백 → 계정 읽기 → 로그아웃을 완료하고 결과를 아래에 기록한다. Google 게시 상태 및 테스트 사용자 정책도 확인한다.
2. 카카오 외부 연결 해제 코드를 7일 복구 유예 정책으로 수정했다. 코드와 로컬 PostgreSQL 검증은 완료했지만 보관 근거 확인 전 운영 DB 적용·Edge Function 배포·카카오 웹훅 활성화는 하지 않았다.
3. 개인정보처리방침의 위탁/국외 이전 국가·연락처·이전 시점 및 방법·제공자 내부 로그/백업 보존기간을 계약과 실제 설정으로 확정한다. 서울 DB만으로 모든 처리가 국내라고 단정하지 않는다. 운영자: 이건하, 문의: this_is_laugh@naver.com.
4. 현재 앱 별도 백업은 없다. 공급자의 내부 복제/운영 백업과 로그가 즉시 모두 삭제된다고 약속하지 않는다. 무료 플랜의 비활성 정지와 백업 제약을 고려해 정식 운영 전 복구 방법을 결정한다.
5. 요청 제한은 여전히 인스턴스별 메모리다. 계정별 제한도 Vercel 인스턴스 간 공유되지 않는다. Jev 2,000회는 전체 과금 보장이 아니며 공유 카운터 도입 전 공개 규모를 제한해야 한다.
6. 한 번의 기록 변경/합치기는 원자적이지만, 수정+추가+대화처럼 여러 저장 동작을 하는 턴 전체가 한 트랜잭션은 아니다. 중간 연결 실패 시 일부가 저장될 수 있어 화면에 알리고 새로고침을 요구한다. 응답 유실 뒤 자동 재시도하지 않는다.

참조: [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [Vercel DPA](https://vercel.com/legal/dpa), [TypeSafe DPA](https://typesafe.ai/legal/data-processing), [TypeSafe 개인정보처리방침](https://typesafe.ai/legal/privacy-policy). 문서의 계약 종료 후 보존기간을 개별 앱 사용자의 삭제 지연 기간으로 대입하지 않는다.

## 환경 변수

Vercel production에 `ACCOUNT_ENABLED=off`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, `PRIVACY_OPERATOR`, `PRIVACY_CONTACT_EMAIL`을 설정했다. `ACCOUNT_PROVIDERS` 기본은 `google,kakao`다. OAuth Client Secret은 Supabase에만 저장한다. 서비스 역할 키는 앱에 사용하지 않는다.

`.env.local`과 `.env.example`은 수정하지 않았다. 로컬 계정 검증이 필요할 때만 위 값을 셸 환경으로 주입하고 APP_ORIGIN을 해당 테스트 origin으로 설정한다. 비밀값은 저장소·문서·채팅에 기록하지 않는다.

## 테스터 안내 초안 — 아직 발송하지 않음

> 계정에 기록을 보관하는 선택 기능을 준비했습니다. 로그인하지 않아도 지금처럼 사용할 수 있습니다. 로그인 후 이 기기의 기록을 합칠지 직접 선택하며, 원본은 기기에 남습니다. 대화 기록은 한국 시간 기준 30일 보관합니다. 계산기 신체정보는 별도 동의로 보관을 켠 경우에만 계정에 저장합니다. 내 계정에서 기록 내보내기와 계정 삭제를 할 수 있습니다. 계정 기록은 인터넷 연결이 있어야 저장되며, 저장 오류가 표시되면 새로고침 후 결과를 확인해 주세요.

## 후속 보강 — 적용 상태를 구분할 것

- 계산기 동의 철회 후 다시 켜면 revision은 0부터 시작한다. 오래된 탭이 새 동의를 덮어쓰거나 철회하지 못하도록 `consent_at`도 읽기·저장·삭제 조건에 포함했다. 설정 화면은 저장 응답의 동의 시각을 사용한다. 스키마 추가 없이 기존 열을 사용한다.
- OAuth 테스트는 동의/나이 확인 누락, 위조 쿠키, 실패한 코드 교환, 기존 기록 보존, 실패 시 세션 정리, 고정 콜백 및 HttpOnly 쿠키를 검사한다. 실제 제공자 가입 완료를 대신하지 않는다.
- 개인정보 화면에 TypeSafe의 미국 처리, 연락처, 입력 학습 제외 정책 및 보존 기준과 Vercel 국외 처리 안내를 추가했다. 공급자별 내부 보존 일수를 임의로 정하지 않았다.
- 검증: typecheck·lint 통과, 전체 59개 파일 1,579개 테스트(이전 58개/1,564개), production build 통과. 3202에서 새 개인정보 안내와 제공자 링크를 확인했다.

### 카카오 연결 해제: 코드 준비, 운영 미적용

준비 파일은 `supabase/functions/kakao-unlink/{index.js,handler.ts}`와 `supabase/migrations/20261007040148_kakao_unlink_cleanup.sql`이다. **이 마이그레이션을 적용했다고 보고하면 안 된다.** 이전 즉시 삭제안은 자동 승인 검토에서 거절되었고, 이후 사용자가 7일 복구 유예 방향의 코드 변경을 요청했다. 미적용 파일을 새 정책으로 수정했으며 운영 DB, Edge Function, 카카오 웹훅은 변경하지 않았다. 기존 즉시 삭제 질문에 대한 응답을 새 정책 활성화 승인으로 재사용하지 않는다.

- 요청은 POST form만 받고 대표 어드민 키의 `KakaoAK` 헤더, 앱 ID `1599886`, 회원번호와 이벤트 종류를 검증한다. 원문·회원번호·인증키를 로그에 남기지 않는다. 2 KB 본문 제한과 중복 파라미터 거절을 둔다.
- `KAKAO_UNLINK_ADMIN_KEY`는 전용 프로젝트의 Edge Function secrets에 저장 완료했다. Vercel/클라이언트/파일에는 복사하지 않았다. 실행 코드는 Supabase가 주입하는 서버 키로 서비스 역할 전용 RPC를 호출한다.
- 카카오만 연결된 계정은 즉시 기록 접근을 차단하고 **알림 수신부터 168시간** 유예한다. 카카오 identity를 남겨 같은 제공자 회원번호의 재인증이 원래 계정으로 돌아오게 한다. 카카오 제공 정보·계정 식별정보를 유예 보관할 수 있는 근거 확인 전에는 활성화하지 않는다. 다른 로그인도 연결된 계정은 카카오 identity와 세션만 제거하고 기록은 유지한다. 나머지 로그인 제공자 목록을 갱신한다.
- 첫 접수는 비공개 큐에 영속 저장하고 즉시 RLS에서 차단한다. 매분 처리 작업이 세션을 취소하고 유예 또는 연결 해제를 반영한다. 실패 시 identity/user UUID와 SQLSTATE만 남겨 재시도한다. 성공한 작업 행은 제거하며 유예 상태는 별도 비공개 행에 보관한다. 유예 중 중복 알림은 최초 기한을 연장하지 않는다.
- 복구는 새 세션과 원래 카카오 identity의 연결 해제 이후 로그인 시각을 검증한다. 이메일 일치로 복구하지 않는다. OAuth 콜백은 기록을 초기화하거나 복구하지 않고 복구 화면으로 보낸다. 화면에서 기록 수집·이용에 다시 동의해야 caller-bound RPC로 원자 복구한다. 계산기 정보는 별도 재동의가 없으면 복구 시 삭제한다는 내용을 표시한다.
- 유예 동안 기록 읽기·쓰기·합치기·내보내기와 로그인 상태 AI 요청을 차단한다. 기기 원본은 변경하지 않는다. 기한 경과 후 cron 실행이 늦어져도 복구는 거절한다. 매분 만료 작업이 계정과 연결 기록을 파기한다. 직접 선택한 계정 삭제는 유예 없이 즉시 처리한다. 대화의 30일 정리는 유예 중에도 유지한다.
- 원본 연결 해제 webhook에는 고유 이벤트 ID/발생 시각이 없으므로, **복구 완료 후** 뒤늦게 같은 알림이 도착하면 새로운 해제와 완전히 구분할 수 없다. 이런 경우 접근을 다시 차단하는 쪽으로 처리한다. 정확한 중복 식별이 필요하면 Kakao SSF 이벤트 도입을 검토한다.
- 계정/프로필 RLS에 활성 세션 확인을 추가하도록 준비했다. 세션 취소 후 아직 만료되지 않은 JWT나 삭제 대기 계정으로 읽고 쓰지 못하게 한다.
- 카카오 연결 해제 웹훅은 내부 오류에도 3초 내 200을 요구하며 재전송을 제공하지 않는다. RPC 타임아웃은 2초다. DB에 최초 접수 자체가 실패하면 영속 재시도가 불가능하므로 `KAKAO_UNLINK_DELIVERY_FAILED` 운영 오류를 남긴다. 이것을 삭제 성공으로 해석하면 안 된다. 운영 장애 시 카카오의 연결 상태와 DB를 대조하는 수동 복구가 필요하다. [카카오 웹훅 정책](https://developers.kakao.com/docs/ko/getting-started/callback)
- 운영 활성화 순서: 보관 근거·동의 문구 확정 → migration 적용(기본 off) → 실제 Supabase 스키마에서 격리 fixture 검증 및 advisor → 앱 `ACCOUNT_RECOVERY_ENABLED=on` 배포 → DB `private.account_lifecycle_settings.enabled=true` → Edge Function 배포(custom auth이므로 verify_jwt=false) → 카카오 POST URL 등록 → 실제 인증·해제·복구 검증. 정책 스위치를 켜기 전에는 webhook을 등록하지 않는다.
- 앱의 `ACCOUNT_RECOVERY_ENABLED`는 기본 off다. DB 설정도 기본 false이며 webhook 접수·큐 처리·기한 후 삭제가 실행되지 않는다. 이미 유예 중인 계정의 RLS 차단은 스위치를 꺼도 유지한다. `.env.local`·`.env.example`과 Vercel 환경 변수는 수정하지 않았다.
- 운영 DB 대신 PGlite 0.5.8의 일회성 메모리 PostgreSQL에서 `supabase/tests/account-recovery.mjs`로 14개 SQL 검사를 통과했다. 실제 RLS/권한/함수/삭제 cascade를 검사하며 Auth 테이블은 최소 fixture, cron 스케줄 등록만 stub이다. 실제 OAuth·Supabase cron·병렬 트랜잭션 검증을 대신하지 않는다. 앱 의존성에는 테스트 도구를 추가하지 않았다.
- 복구 변경 검증: `pnpm typecheck`, `pnpm lint`(경고 없음), `pnpm test`(60개 파일/1,595개), `pnpm build` 통과. 이전 59개/1,579개에서 복구 API·콜백 분기·세션 취소·유예 중 프로필 로컬 대체 방지 검사를 추가했다.
- SQL 검사 재현: 임시 디렉터리에 `npm install --prefix <temp-path> --no-save --ignore-scripts @electric-sql/pglite@0.5.8` 후 `node supabase/tests/account-recovery.mjs <temp-path>/node_modules/@electric-sql/pglite/dist/index.js`. 외부 연결이나 실제 사용자·키 없이 실행한다.
- 적용 후 오류 확인 SQL: `select count(*) as pending, min(received_at) as oldest, max(attempts) as attempts from private.kakao_unlink_jobs;`. 대기 행이 지속되면 `last_error_code`와 cron 실행 결과를 확인한다. 사용자의 UUID나 원문을 운영 보고에 출력하지 않는다.

### 공급자 계약 확인 결과와 공개 제한

- Supabase Free에는 이 앱이 이용할 수 있는 일일 자동 복원 백업을 전제로 하지 않는다. [공식 백업 문서](https://supabase.com/docs/guides/platform/backups)는 Free에서 직접 export를 권하고 Pro부터 일일 백업 기간을 명시한다. 현재 운영자 별도 백업은 만들지 않았고 보존기간도 없다. 앱 JSON 내보내기는 사용자 기록 사본이며 Supabase Auth 전체 복구 수단은 아니다.
- [TypeSafe 개인정보처리방침](https://typesafe.ai/legal/privacy-policy)은 미국 호스팅, 입력 학습 제외, `privacy@typesafe.ai`, 목적상 필요한 기간 보존을 명시한다. [DPA](https://typesafe.ai/legal/data-processing)에도 확정 일수는 없다. 같은 방침의 18세 미만 항목과 이 앱의 14세 가입 기준이 API 최종 사용자에게 어떻게 적용되는지는 공개 문서만으로 확정하지 못했다. 확인 전 계정 공개 범위를 확대하지 않는다.
- [Vercel 개인정보 안내](https://vercel.com/legal/privacy-notice)는 미국 및 다른 운영 지역 처리를 알린다. [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum)의 계약 종료 후 삭제 조항을 사용자 탈퇴 시 백업 삭제 일수로 바꾸어 적지 않는다.
- **운영 기능 스위치는 계속 off**다. 실제 Google·카카오 계정 가입은 사용자 본인의 나이 확인·가입 동의를 대신 확정할 수 없어 미완료이며, Google 앱도 testing 상태다. 이 상태와 문서 보강만으로 일반 공개 준비 완료라고 판단하지 않는다.
