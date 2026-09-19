import { PrismaClient, Role, StatusKaryawan } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@arsaba.local";
  const plainPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!plainPassword) {
    console.error("SEED_ADMIN_PASSWORD belum diset di .env. Set dulu sebelum menjalankan seed.");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Akun dengan email ${email} sudah ada, seed dilewati.`);
    return;
  }

  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const admin = await prisma.user.create({
    data: {
      nama: "Admin Arsaba",
      email,
      hashedPassword,
      role: Role.ADMIN,
      status: StatusKaryawan.AKTIF,
    },
  });

  console.log("Akun Admin berhasil dibuat:");
  console.log(`  Email    : ${admin.email}`);
  console.log(`  Password : ${plainPassword} (WAJIB DIGANTI setelah login pertama)`);
  console.log(`  Role     : ${admin.role}`);
}

main()
  .catch((e) => {
    console.error("Seed gagal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });