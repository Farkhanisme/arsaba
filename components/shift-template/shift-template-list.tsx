import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Props = {
  storeId: string;
};

function formatHariKerja(hariKerja: number[]): string {
  if (hariKerja.length === 0) return "Semua hari";
  if (JSON.stringify([...hariKerja].sort()) === JSON.stringify([1, 2, 3, 4, 5])) return "Weekday (Sen–Jum)";
  if (JSON.stringify([...hariKerja].sort()) === JSON.stringify([6, 0])) return "Weekend (Sab–Min)";
  const labels = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  return hariKerja.map((h) => labels[h]).join(", ");
}

function formatJam(menit: number): string {
  const jam = Math.floor(menit / 60);
  const m = menit % 60;
  return `${String(jam).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function ShiftTemplateList({ storeId }: Props) {
  const templates = await prisma.shiftTemplate.findMany({
    where: { storeId },
    orderBy: [{ aktif: "desc" }, { jamMulaiMenit: "asc" }],
  });

  if (templates.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="mb-2">Belum ada template shift untuk toko ini.</p>
        <Link href={`/master/toko/${storeId}/shift-template/baru`}>
          <Button size="sm">Buat Template Pertama</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {templates.map((t) => (
        <Link key={t.id} href={`/master/toko/${storeId}/shift-template/${t.id}`} className="block">
          <Card className={`transition-colors hover:bg-muted/50 ${!t.aktif && "opacity-60"}`}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 py-3">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base truncate flex items-center gap-2">
                  {t.nama}
                  {!t.aktif && (
                    <span className="text-xs font-normal text-destructive bg-destructive/10 px-2 py-0.5 rounded">
                      Nonaktif
                    </span>
                  )}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatJam(t.jamMulaiMenit)} – {formatJam(t.jamSelesaiMenit)}
                  {t.lintasHari && " <span className='text-primary'>(lintas hari)</span>"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatHariKerja(t.hariKerja)}
                </span>
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}