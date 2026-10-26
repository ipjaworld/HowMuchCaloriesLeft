import Link from "next/link";
import { env } from "@/env";
import { accountConfigured } from "@/infrastructure/accountAuth";
import { sharedRateLimitConfigured } from "@/infrastructure/serverUsageLimits";

/** Set to the day this version is published; the previous version stays listed. */
const EFFECTIVE_DATE = "2026년 10월 26일";
const PREVIOUS_VERSIONS = ["2026년 10월 7일"];

/**
 * Overseas processing as 개인정보 보호법 제28조의8 제2항 asks it to be told:
 * what, where, when and how, to whom, why and for how long, and how to refuse.
 * Each row has to match what the code actually sends.
 */
const TRANSFERS: {
  recipient: string;
  country: string;
  task: string;
  items: string;
  when: string;
  retention: string;
  refuse: string;
  contact: { label: string; href: string };
  /** Shown only while the feature that sends it is on. */
  only?: "account" | "sharedLimits";
}[] = [
  {
    recipient: "TypeSafe AI, Inc.",
    country: "미국",
    task: "음식 입력의 의도·섭취 여부 판단",
    items: "입력 문장, 판단 시각, 하루 목표 숫자, 최근 음식 기록(음식 이름·양·kcal·먹은 시각), 판단할 문장 조각",
    when: "음식 입력을 보낼 때마다 암호화된 통신(HTTPS)으로 전송",
    retention: "제공자 기준(서비스 제공과 법적 의무에 필요한 기간). 입력을 모델 학습·미세 조정에 쓰지 않는다고 명시",
    refuse: "음식 판단의 핵심 기능이라 거부하면 음식 입력을 사용할 수 없습니다",
    contact: { label: "privacy@typesafe.ai", href: "mailto:privacy@typesafe.ai" },
  },
  {
    recipient: "Vercel Inc.",
    country: "미국(앱 서버 리전: 미국 동부) 및 제공자가 운영하는 지역",
    task: "앱 호스팅과 요청 처리",
    items: "앱으로 보내는 요청 내용(위 입력 정보, 로그인 시 세션 쿠키), 접속 기록(IP 주소 등)",
    when: "앱을 이용할 때마다 암호화된 통신(HTTPS)으로 전송",
    retention: "앱은 요청 처리 후 따로 저장하지 않음. 네트워크·보안 로그는 제공자 정책을 따름",
    refuse: "앱 제공에 필요해 거부하면 앱을 이용할 수 없습니다",
    contact: { label: "privacy@vercel.com", href: "mailto:privacy@vercel.com" },
  },
  {
    recipient: "Supabase, Inc.",
    country: "저장 리전은 대한민국(서울). 제공자의 운영·지원 처리는 미국·싱가포르 등에서 이뤄질 수 있음",
    task: "로그인 인증과 계정 기록 보관",
    items: "로그인 제공자 계정 식별자·이메일·이름, 로그인 세션, 동의 시각, 식사 기록·목표 숫자·대화 기록, 별도 동의 시 계산기 정보",
    when: "로그인하거나 계정에 기록을 저장할 때 암호화된 통신(HTTPS)으로 전송",
    retention: "계정 삭제 시까지(대화는 30일, 계산기 정보는 동의 철회 시까지)",
    refuse: "로그인하지 않으면 전송되지 않으며, 로그인 없이 기기에서 계속 사용할 수 있습니다",
    contact: { label: "privacy@supabase.com", href: "mailto:privacy@supabase.com" },
    only: "account",
  },
  {
    recipient: "Upstash, Inc.",
    country: "미국(저장 리전: 미국 동부)",
    task: "요청 제한을 위한 요청 횟수 집계",
    items: "IP 주소·계정 식별자를 비밀키로 변환한 HMAC 값과 요청 횟수(원본 IP는 보내지 않음)",
    when: "앱에 요청할 때마다 암호화된 통신(HTTPS)으로 전송",
    retention: "집계 기간(1분 또는 하루)이 끝나면 자동 만료",
    refuse: "남용 방지에 필요해 거부하면 앱을 이용할 수 없습니다",
    contact: { label: "privacy@upstash.com", href: "mailto:privacy@upstash.com" },
    only: "sharedLimits",
  },
];

export default function PrivacyPage() {
  const account = accountConfigured();
  const shown = { account, sharedLimits: sharedRateLimitConfigured() };
  const operator = env.PRIVACY_OPERATOR ?? "이건하";
  const contact = env.PRIVACY_CONTACT_EMAIL ?? "this_is_laugh@naver.com";
  return (
    <main className="app-shell space-y-6 px-6 py-10 text-sm leading-7 sm:px-10">
      <h1 className="page-title">개인정보처리방침</h1>
      <p>시행일: {EFFECTIVE_DATE}</p>
      {!account && <p>계정 기능은 현재 준비 중입니다.</p>}
      <p>
        운영자: {operator} · 문의: <a href={`mailto:${contact}`}>{contact}</a>
      </p>

      <h2 className="font-semibold">1. 처리 목적과 항목</h2>
      <p>
        <strong>로그인 없이 사용할 때.</strong> 식사 기록, 목표, 대화 기록,
        계산기 입력값은 이 브라우저에 저장합니다. 식사 입력을 처리할 때 입력
        문장·시각·목표 숫자·오늘의 음식 기록을 앱 API로 보냅니다. 의도 판단을
        위해 TypeSafe AI(Jev)에 필요한 문장과 음식 맥락을 전달합니다. 계산기
        입력값은 이 판단 요청에 넣지 않습니다.
      </p>
      <p>
        <strong>계정을 사용할 때.</strong> 로그인 제공자의 계정 식별자와 제공되는
        이메일·이름, 로그인 세션, 동의 시각을 인증 및 계정 관리에 사용합니다.
        식사 기록, 목표 숫자, 대화 기록은 계정 보관과 여러 기기 조회에
        사용합니다. 기존 기기 기록은 합치기에 동의했을 때만 전송합니다. 만
        14세 미만의 가입은 받지 않습니다. 가입에 동의하지 않아도 기기에서 사용할
        수 있습니다.
      </p>
      <p>
        <strong>계산기 정보(선택).</strong> 키·몸무게·나이·성별·활동량·목표 방식은
        기본적으로 기기에만 저장합니다. 별도 수집·이용에 동의하여 계정 보관을 켠
        경우에만 여러 기기의 계산기에서 사용하는 목적으로 계정에 저장합니다.
        동의하지 않아도 나머지 기능을 사용할 수 있습니다. 유지 칼로리 계산값은
        저장하지 않으며 계산기 입력값을 음식 판단 AI에 전달하지 않습니다.
      </p>

      <h2 className="font-semibold">2. 보유 기간과 파기</h2>
      <p>
        계정과 식사·목표 기록은 계정 삭제 시까지 보관합니다. 대화는 한국 시간
        기준 오늘과 이전 29일만 보관하며 매일 만료 대화를 정리합니다. 계산기
        정보는 동의 철회 또는 계정 삭제 시까지 보관하고, 보관을 끄면 계정의
        계산기 정보를 즉시 삭제합니다.
      </p>
      <p>
        계정을 삭제하면 운영 DB에서 계정과 연결된 기록을 즉시 삭제합니다. 기기에
        저장된 원본은 자동 삭제하지 않으며, 브라우저의 사이트 데이터 삭제로 지울
        수 있습니다. 관리형 제공자의 내부 운영 복제·로그 보존은 제공자 정책을
        따릅니다.
      </p>
      {account && (
        <p>
          계정 DB는 운영자가 장애 복구 목적으로 한 달에 한 번 암호화해 백업할 수
          있으며, 최근 3개(약 90일)만 보관합니다. 계정을 삭제해도 그 전에 만든
          백업에는 최대 90일 동안 남았다가 오래된 순서대로 삭제됩니다. 백업은 복구
          외의 목적으로 쓰지 않습니다.
        </p>
      )}
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

      <h2 className="font-semibold">3. 처리 위탁과 국외 이전</h2>
      <p>
        아래 업무를 위탁하며, 이 과정에서 개인정보가 국외로 이전됩니다. 서비스
        제공에 필요한 위탁·보관으로서 이 방침에 공개하는 방식으로 알립니다.
        제3자에게 개인정보를 판매하거나 제공하지 않습니다.
      </p>
      <div className="space-y-4">
        {TRANSFERS.filter((row) => row.only === undefined || shown[row.only]).map((row) => (
          <dl key={row.recipient} className="rounded-2xl border border-ink/10 p-4">
            <dt className="font-semibold">{row.recipient}</dt>
            <dd>이전 국가: {row.country}</dd>
            <dd>위탁 업무: {row.task}</dd>
            <dd>이전 항목: {row.items}</dd>
            <dd>이전 시기·방법: {row.when}</dd>
            <dd>보유·이용 기간: {row.retention}</dd>
            <dd>거부 방법과 효과: {row.refuse}</dd>
            <dd>
              연락처: <a className="underline" href={row.contact.href}>{row.contact.label}</a>
            </dd>
          </dl>
        ))}
      </div>
      <p>
        {account && "Google·카카오 로그인은 이용자가 선택한 제공자에서 직접 인증합니다. "}
        서비스 운영을 위한 네트워크·보안 로그는 각 제공자의 정책에 따라 처리될 수
        있습니다.{" "}
        <a className="underline" href="https://typesafe.ai/legal/privacy-policy">TypeSafe 개인정보처리방침</a>
        {" · "}
        <a className="underline" href="https://vercel.com/legal/privacy-notice">Vercel 안내</a>
      </p>

      <h2 className="font-semibold">4. 안전성 확보 조치</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>앱과 제공자 사이의 모든 전송은 암호화된 통신(HTTPS)을 사용합니다.</li>
        <li>계정 기록은 로그인한 본인 계정의 행만 읽고 쓸 수 있도록 DB 접근 정책으로 제한합니다.</li>
        <li>로그인 세션과 동의 확인 쿠키는 브라우저 스크립트가 읽을 수 없는 HttpOnly 쿠키로 다룹니다.</li>
        <li>요청 제한 카운터에는 원본 IP 대신 비밀키로 변환한 HMAC 값을 사용합니다.</li>
        <li>제공자 인증키는 서버에만 두며, 앱은 DB 관리자 권한 키를 사용하지 않습니다.</li>
        {account && <li>계정 DB 백업은 암호화해 운영자 기기에만 보관하고 저장소나 외부 서비스에 올리지 않습니다.</li>}
      </ul>

      <h2 className="font-semibold">5. 쿠키와 브라우저 저장</h2>
      <p>
        로그인 없이 사용할 때의 기록은 브라우저 저장소(localStorage)에 둡니다.
        계정 기능은 로그인 세션 유지와 가입 동의 확인에 쿠키를 사용합니다. 광고나
        이용 분석을 위한 쿠키·추적 도구는 사용하지 않습니다. 브라우저 설정에서
        쿠키를 막으면 로그인을 사용할 수 없고, 사이트 데이터를 지우면 기기의 기록이
        삭제됩니다.
      </p>

      <h2 className="font-semibold">6. 내 정보 관리</h2>
      <p>
        내 계정에서 기록을 JSON으로 내려받거나 계정을 삭제할 수 있습니다.
        열람·정정·삭제·처리정지 요청은 아래 문의 이메일로 보내 주세요. 신체정보를
        계정에 보관하는 기능은 별도의 동의 없이 켜지지 않습니다.
      </p>

      <h2 className="font-semibold">7. 개인정보 보호책임자</h2>
      <p>
        {operator} · <a href={`mailto:${contact}`}>{contact}</a>
      </p>

      <h2 className="font-semibold">8. 권익침해 구제</h2>
      <p>개인정보 침해에 대한 신고나 상담이 필요하면 아래 기관에 문의할 수 있습니다.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>개인정보침해신고센터: privacy.kisa.or.kr · 국번 없이 118</li>
        <li>개인정보분쟁조정위원회: www.kopico.go.kr · 1833-6972</li>
        <li>대검찰청: www.spo.go.kr · 국번 없이 1301</li>
        <li>경찰청: ecrm.police.go.kr · 국번 없이 182</li>
      </ul>

      <h2 className="font-semibold">9. 변경</h2>
      <p>
        이 방침을 바꾸면 이 화면에 시행일과 함께 알립니다. 이전 버전 시행일:{" "}
        {PREVIOUS_VERSIONS.join(", ")}
      </p>

      <Link className="underline" href="/account">
        내 계정으로
      </Link>
    </main>
  );
}
