"use client";

import { useState } from "react";
import { RiwayatSetor } from "./riwayat-setor";
import { SetorForm } from "./setor-form";

type Props = {
  tokoList: { id: string; nama: string }[];
};

export function SetoranHome({ tokoList }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <SetorForm tokoList={tokoList} onTerkirim={() => setRefreshKey((k) => k + 1)} />
      <RiwayatSetor refreshKey={refreshKey} />
    </div>
  );
}
