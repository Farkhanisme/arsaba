import { PrismaClient, Role, StatusKaryawan } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const kode = "EMP-001";
  const plainPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!plainPassword) {
    console.error("SEED_ADMIN_PASSWORD belum diset di .env. Set dulu sebelum menjalankan seed.");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { kode } });
  if (existing) {
    console.log(`Akun dengan kode ${kode} sudah ada, seed dilewati.`);
    return;
  }

  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const admin = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        kode,
        nama: "Admin Arsaba",
        hashedPassword,
        role: Role.ADMIN,
        status: StatusKaryawan.AKTIF,
      },
    });

    // Set counter agar generate kode berikutnya mulai dari 002
    await tx.kodeCounter.upsert({
      where: { prefix: "EMP" },
      create: { prefix: "EMP", lastNumber: 1 },
      update: { lastNumber: 1 },
    });

    return created;
  });

  console.log("Akun Admin berhasil dibuat:");
  console.log(`  Kode     : ${admin.kode}`);
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
