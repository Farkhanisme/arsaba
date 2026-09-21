import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./lib/prisma";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";

const nextAuth = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        kode: { label: "Kode Karyawan", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.kode || !credentials?.password) {
          return null;
        }

        const kode = (credentials.kode as string).trim().toUpperCase();

        const user = await prisma.user.findUnique({
          where: { kode },
        });

        if (!user || !user.hashedPassword) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.hashedPassword
        );

        if (!isValid) {
          return null;
        }

        if (user.status === "NONAKTIF" || user.status === "RESIGN") {
          return null;
        }

        return {
          id: user.id,
          kode: user.kode,
          name: user.nama,
          nama: user.nama,
          role: user.role,
          storeId: user.storeId ?? null,
          status: user.status,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.kode = user.kode!;
        token.role = user.role!;
        token.storeId = user.storeId ?? null;
        token.status = user.status!;
        token.nama = user.nama!;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.kode = token.kode;
        session.user.role = token.role;
        session.user.storeId = token.storeId;
        session.user.status = token.status;
        session.user.nama = token.nama;
      }
      return session;
    },
  },
});
export const { handlers, signIn, signOut, auth } = nextAuth;
