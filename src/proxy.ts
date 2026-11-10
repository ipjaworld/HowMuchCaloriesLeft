import { NextResponse, type NextRequest } from "next/server";
import { isLegacyHost, MOVED_PATH } from "./application/legacyHost";

/**
 * An address the app has moved away from serves one page: where it went, and
 * a way to carry this browser's records there. Records live in localStorage,
 * which is per address, so a plain redirect would leave them behind.
 *
 * With `LEGACY_HOSTS` unset this does nothing.
 */
export function proxy(request: NextRequest) {
  if (!isLegacyHost(request.headers.get("host"), process.env)) return NextResponse.next();
  if (request.nextUrl.pathname === MOVED_PATH) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = MOVED_PATH;
  url.search = "";
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: the API, build assets and files keep answering as they are.
  matcher: ["/((?!api/|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
