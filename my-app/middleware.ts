import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PROD_HOST = "sqlquery-analyzer.vercel.app";

export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV === "development") return NextResponse.next();
  const host = req.headers.get("host") || "";
  if (host !== PROD_HOST) {
    const url = new URL(req.url);
    url.host = PROD_HOST;
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
