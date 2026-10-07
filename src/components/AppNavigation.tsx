import Link from "next/link";

export function AppNavigation({ current, signedIn = false }: {
  current: "today" | "history" | "account";
  signedIn?: boolean;
}) {
  const entries = [
    { key: "today", href: "/", label: "오늘" },
    { key: "history", href: "/history", label: "기록" },
    { key: "account", href: "/account", label: signedIn ? "내 계정" : "로그인" },
  ];
  return (
    <header className="app-navigation">
      <Link href="/" className="brand-mark" aria-label="오늘 얼마 먹어도 돼? 홈">
        <span className="brand-seed" aria-hidden="true" />
        오늘 얼마 먹어도 돼?
      </Link>
      <nav aria-label="주요 메뉴" className="flex gap-1">
        {entries.map(({ key, href, label }) => (
          <Link key={key} href={href} aria-current={current === key ? "page" : undefined}
            className="nav-link">{label}</Link>
        ))}
      </nav>
    </header>
  );
}
