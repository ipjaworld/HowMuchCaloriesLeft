import Link from "next/link";
import { env } from "@/env";
import { accountConfigured } from "@/infrastructure/accountAuth";
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[40rem] space-y-6 p-6 text-sm leading-7">
      <h1 className="text-xl font-semibold">개인정보처리방침</h1>
      <p>시행일: 2026년 10월 7일</p>
      {!accountConfigured() && <p>계정 기능은 현재 준비 중입니다.</p>}
      <p>
        운영자: {env.PRIVACY_OPERATOR ?? "이건하"} · 문의:{" "}
        <a
          href={`mailto:${env.PRIVACY_CONTACT_EMAIL ?? "this_is_laugh@naver.com"}`}
        >
          {env.PRIVACY_CONTACT_EMAIL ?? "this_is_laugh@naver.com"}
        </a>
      </p>
      <h2 className="font-semibold">로그인 없이 사용할 때</h2>
      <p>
        식사 기록, 목표, 대화 기록, 계산기 입력값은 이 브라우저에 저장합니다.
        식사 입력을 처리할 때 입력 문장·시각·목표 숫자·오늘의 음식 기록을 앱
        API로 보냅니다. 의도 판단을 위해 TypeSafe AI(Jev)에 필요한 문장과 음식
        맥락을 전달합니다. 계산기 입력값은 이 판단 요청에 넣지 않습니다.
      </p>
      <h2 className="font-semibold">계정을 사용할 때</h2>
      <p>
        로그인 제공자의 계정 식별자와 제공되는 이메일·이름, 로그인 세션, 동의
        시각을 인증 및 계정 관리에 사용합니다. 식사 기록, 목표 숫자, 대화 기록은
        계정 보관과 여러 기기 조회에 사용합니다. 기존 기기 기록은 합치기에
        동의했을 때만 전송합니다. 만 14세 미만의 가입은 받지 않습니다. 가입에
        동의하지 않아도 기기에서 사용할 수 있습니다.
      </p>
      <h2 className="font-semibold">보관과 삭제</h2>
      <p>
        계정과 식사·목표 기록은 계정 삭제 시까지 보관합니다. 대화는 한국 시간
        기준 오늘과 이전 29일만 보관하며 매일 만료 대화를 정리합니다. 계정을
        삭제하면 운영 DB의 계정과 연결된 기록을 즉시 삭제합니다. 기기 원본은
        자동 삭제하지 않습니다. 현재 앱이 별도로 만드는 백업은 없으며, 관리형
        제공자의 내부 운영 복제·로그 보존은 제공자 정책을 따릅니다.
      </p>
      {env.ACCOUNT_RECOVERY_ENABLED === "on" && <>
        <h2 className="font-semibold">카카오 연결 해제와 복구</h2>
        <p>같은 계정에 다른 로그인 수단이 연결되어 있으면 카카오 연결을 제거하고 기록을 유지합니다.
          카카오만 연결된 계정은 연결 해제 알림 수신 즉시 기록 접근을 차단하고, 실수로 해제한 기록을 복구할 수 있도록
          수신 시각부터 7일(168시간) 동안 계정 식별정보와 계정 기록을 제한 보관합니다.
          같은 카카오 계정으로 다시 인증하고 수집·이용에 재동의해야 복구할 수 있습니다.
          기한이 지나면 복구가 차단되며 계정과 기록은 정기 삭제 작업으로 파기합니다.
          대화는 유예 중에도 기존 30일 기준에 따라 정리합니다.
          앱에서 직접 계정 삭제를 선택하면 유예 없이 즉시 삭제합니다.</p>
      </>}
      <h2 className="font-semibold">계산기 정보 보관 (선택)</h2>
      <p>
        키·몸무게·나이·성별·활동량·목표 방식은 기본적으로 기기에만 저장합니다.
        별도 수집·이용에 동의하여 계정 보관을 켠 경우에만 여러 기기의 계산기에서
        사용하는 목적으로 계정에 저장하며, 동의 철회 또는 계정 삭제 시까지 보관합니다.
        보관을 끄면 계정의 계산기 정보는 즉시 삭제하며 기기 원본은 남습니다.
        동의하지 않아도 나머지 기능을 사용할 수 있습니다. 유지 칼로리 계산값은 저장하지
        않으며 계산기 입력값을 음식 판단 AI에 전달하지 않습니다.
      </p>
      <h2 className="font-semibold">서비스 제공자</h2>
      <p>
        Vercel은 앱 호스팅, Supabase는 인증 및 서울 리전 데이터 보관, TypeSafe
        AI는 입력 의도 판단을 제공합니다. Google·카카오는 선택한 소셜 로그인을
        제공합니다. 서비스 운영을 위한 네트워크·보안 로그는 각 제공자의 정책에
        따라 처리될 수 있습니다. 앱의 요청 제한 카운터에는 원본 IP 대신 HMAC
        값을 사용합니다.
      </p>
      <h2 className="font-semibold">외부 처리와 문의</h2>
      <p>
        음식 문장을 판단할 때 필요한 입력을 암호화된 통신으로 TypeSafe AI,
        Inc.에 전송합니다. TypeSafe는 미국에서 서비스를 운영하며, 입력을 모델
        학습이나 미세 조정에 사용하지 않는다고 명시합니다. 보존기간은 서비스
        제공 목적과 법적 의무에 필요한 기간이라는 제공자 기준을 따릅니다.
        문의는 privacy@typesafe.ai로 할 수 있습니다.{" "}
        <a className="underline" href="https://typesafe.ai/legal/privacy-policy">
          TypeSafe 개인정보처리방침
        </a>
      </p>
      <p>
        Vercel은 미국 및 운영하는 다른 지역에서 요청을 처리할 수 있습니다.
        문의는 privacy@vercel.com로 할 수 있습니다. Supabase의 계정 데이터
        저장 리전은 서울이지만 제공자의 운영·지원 처리가 모두 국내에
        한정된다는 뜻은 아닙니다.{" "}
        <a className="underline" href="https://vercel.com/legal/privacy-notice">Vercel 안내</a>
        {" · "}
        <a className="underline" href="https://supabase.com/legal/customer-resources/data-processing-addendum">
          Supabase 데이터 처리 안내
        </a>
      </p>
      <h2 className="font-semibold">내 정보 관리</h2>
      <p>
        내 계정에서 기록을 JSON으로 내려받거나 계정을 삭제할 수 있습니다.
        열람·정정·삭제·처리정지 요청은 위 문의 이메일로 보내 주세요. 신체정보를
        계정에 보관하는 기능은 별도의 동의 없이 켜지지 않습니다.
      </p>
      <Link className="underline" href="/account">
        내 계정으로
      </Link>
    </main>
  );
}
