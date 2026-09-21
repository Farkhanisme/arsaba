import "next-auth";
import { DefaultSession } from "next-auth";
import { JWT } from "next-auth/jwt";
import type { Role, StatusKaryawan } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      storeId: string | null;
      status: StatusKaryawan;
      nama: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    storeId: string | null;
    status: StatusKaryawan;
    nama: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    storeId: string | null;
    status: StatusKaryawan;
    nama: string;
  }
}
