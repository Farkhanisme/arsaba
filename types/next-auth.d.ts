import "next-auth";
import { DefaultSession } from "next-auth";
import { JWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      storeId: string | null;
      status: string;
      nama: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    storeId: string | null;
    status: string;
    nama: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    storeId: string | null;
    status: string;
    nama: string;
  }
}