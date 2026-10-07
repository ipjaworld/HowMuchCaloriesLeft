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
2. 카카오 외부 연결 해제 이벤트의 처리 경로를 마련한다. 현재 앱 안의 계정 삭제는 구현됐지만 카카오 설정에서 직접 연결을 해제한 경우를 전달하는 웹훅은 아직 연결하지 않았다.
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
