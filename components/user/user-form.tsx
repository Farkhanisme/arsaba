"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Role } from "@prisma/client";

type Store = {
  id: string;
  nama: string;
};

type InitialUser = {
  kode: string;
  nama: string;
  role: Role;
  storeId: string | null;
  status: string;
  tanggalMasuk: string | null;
  nik: string | null;
  tempatLahir: string | null;
  tanggalLahir: string | null;
  alamat: string | null;
  kontakDarurat: string | null;
};

type Props =
  | {
      mode: "create";
      stores: Store[];
      currentUserRole: Role;
    }
  | {
      mode: "edit";
      userId: string;
      initial: InitialUser;
      stores: Store[];
      currentUserRole: Role;
    };

const ROLE_OPTIONS: Role[] = [
  "KARYAWAN",
  "KEPALA_TOKO",
  "SUPERVISOR",
  "ADMIN",
  "MANAJER",
  "DIREKTUR",
];

// Roles yang boleh lihat/edit PII (Admin, Manajer, Supervisor)
function canAccessPII(role: Role): boolean {
  return ["ADMIN", "MANAJER", "SUPERVISOR"].includes(role);
}

export function UserForm(props: Props) {
  const router = useRouter();
  const isCreate = props.mode === "create";

  const [nama, setNama] = useState(isCreate ? "" : props.initial.nama);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(isCreate ? "KARYAWAN" : props.initial.role);
  const [storeId, setStoreId] = useState(
    isCreate ? "" : props.initial.storeId ?? ""
  );
  const [status, setStatus] = useState(isCreate ? "AKTIF" : props.initial.status);
  const [tanggalMasuk, setTanggalMasuk] = useState(
    isCreate ? "" : props.initial.tanggalMasuk?.slice(0, 10) ?? ""
  );

  const [nik, setNik] = useState(isCreate ? "" : props.initial.nik ?? "");
  const [tempatLahir, setTempatLahir] = useState(
    isCreate ? "" : props.initial.tempatLahir ?? ""
  );
  const [tanggalLahir, setTanggalLahir] = useState(
    isCreate ? "" : props.initial.tanggalLahir?.slice(0, 10) ?? ""
  );
  const [alamat, setAlamat] = useState(isCreate ? "" : props.initial.alamat ?? "");
  const [kontakDarurat, setKontakDarurat] = useState(
    isCreate ? "" : props.initial.kontakDarurat ?? ""
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const showPII = canAccessPII(props.currentUserRole);

  const submit = async () => {
    if (nama.trim().length < 2) {
      toast.error("Nama minimal 2 karakter.");
      return;
    }
    if (isCreate && password.length < 6) {
      toast.error("Password minimal 6 karakter.");
      return;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        nama: nama.trim(),
        role,
        storeId: storeId === "" ? null : storeId,
        status,
        tanggalMasuk: tanggalMasuk === "" ? null : tanggalMasuk,
        nik: nik.trim() === "" ? null : nik.trim(),
        tempatLahir: tempatLahir.trim() === "" ? null : tempatLahir.trim(),
        tanggalLahir: tanggalLahir === "" ? null : tanggalLahir,
        alamat: alamat.trim() === "" ? null : alamat.trim(),
        kontakDarurat: kontakDarurat.trim() === "" ? null : kontakDarurat.trim(),
      };

      if (isCreate) {
        body.password = password;
      }

      const url = isCreate ? "/api/user" : `/api/user/${props.userId}`;
      const method = isCreate ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Gagal (HTTP ${res.status})`);
        return;
      }

      if (isCreate) {
        toast.success(`Karyawan dibuat dengan kode ${data.kode}. Catat kode ini untuk login.`, {
          duration: 10000,
        });
      } else {
        toast.success("Karyawan diubah.");
      }
      router.push("/master/karyawan");
      router.refresh();
    } catch {
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {!isCreate && (
        <div className="space-y-1">
          <Label htmlFor="kode">Kode Karyawan</Label>
          <Input id="kode" value={props.initial.kode} disabled readOnly />
          <p className="text-xs text-muted-foreground">
            Kode untuk login. Tidak bisa diubah.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="nama">Nama</Label>
        <Input
          id="nama"
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {isCreate && (
        <div className="space-y-1">
          <Label htmlFor="password">Password awal (min 6)</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            Kode login akan di-generate otomatis setelah submit.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={isSubmitting}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="store">Toko</Label>
          <select
            id="store"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            disabled={isSubmitting}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— tanpa toko —</option>
            {props.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nama}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={isSubmitting}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="AKTIF">AKTIF</option>
            <option value="RESIGN">RESIGN</option>
            <option value="NONAKTIF">NONAKTIF</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="tanggalMasuk">Tanggal masuk</Label>
          <Input
            id="tanggalMasuk"
            type="date"
            value={tanggalMasuk}
            onChange={(e) => setTanggalMasuk(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
      </div>

      {showPII && (
        <>
          <h3 className="border-t pt-4 text-sm font-semibold">Data Pribadi (Opsional)</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nik">NIK</Label>
              <Input
                id="nik"
                value={nik}
                onChange={(e) => setNik(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="kontakDarurat">Kontak darurat</Label>
              <Input
                id="kontakDarurat"
                value={kontakDarurat}
                onChange={(e) => setKontakDarurat(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tempatLahir">Tempat lahir</Label>
              <Input
                id="tempatLahir"
                value={tempatLahir}
                onChange={(e) => setTempatLahir(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tanggalLahir">Tanggal lahir</Label>
              <Input
                id="tanggalLahir"
                type="date"
                value={tanggalLahir}
                onChange={(e) => setTanggalLahir(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="alamat">Alamat</Label>
            <textarea
              id="alamat"
              rows={2}
              value={alamat}
              onChange={(e) => setAlamat(e.target.value)}
              disabled={isSubmitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </>
      )}

      <div className="flex gap-2 border-t pt-4">
        <Button type="button" onClick={submit} disabled={isSubmitting}>
          {isSubmitting
            ? "Menyimpan..."
            : isCreate
            ? "Simpan Karyawan"
            : "Simpan Perubahan"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/master/karyawan")}
          disabled={isSubmitting}
        >
          Batal
        </Button>
      </div>
    </div>
  );
}
