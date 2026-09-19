import { authConfig } from "./auth.config";
import NextAuth from "next-auth";

const nextAuth = NextAuth({
  ...authConfig,
  providers: [],
});

export const { auth } = nextAuth;

export default auth;

export const config = {
  matcher: ["/dashboard/:path*"],
};