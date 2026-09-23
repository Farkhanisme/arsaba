"use client";

import { useState, useEffect } from "react";
import { cn } from "cn";

type Props = {
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  label?: string;
};

const HARI_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const HARI_FULL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const PRESETS = [
  { key: "SEMUA", label: "Semua Hari", hari: [] as number[] },
  { key: "WEEKDAY", label: "Weekday (Sen–Jum)", hari: [1, 2, 3, 4, 5] },
  { key: "WEEKEND", label: "Weekend (Sab–Min)", hari: [6, 0] },
  { key: "KUSTOM", label: "Custom", hari: null },
];

export function HariKerjaPicker({ value, onChange, disabled, label }: Props) {
  const [preset, setPreset] = useState<"SEMUA" | "WEEKDAY" | "WEEKEND" | "KUSTOM">("SEMUA");
  const [customHari, setCustomHari] = useState<number[]>([]);

  // Sync preset dari value saat pertama load
  useEffect(() => {
    if (value.length === 0) {
      setPreset("SEMUA");
      setCustomHari([]);
    } else if (arraysEqual(value, [1, 2, 3, 4, 5])) {
      setPreset("WEEKDAY");
      setCustomHari([]);
    } else if (arraysEqual(value, [6, 0])) {
      setPreset("WEEKEND");
      setCustomHari([]);
    } else {
      setPreset("KUSTOM");
      setCustomHari([...value].sort((a, b) => a - b));
    }
  }, []);

  // Sync value ke parent saat berubah
  useEffect(() => {
    let newValue: number[];
    if (preset === "SEMUA") newValue = [];
    else if (preset === "WEEKDAY") newValue = [1, 2, 3, 4, 5];
    else if (preset === "WEEKEND") newValue = [6, 0];
    else newValue = [...customHari].sort((a, b) => a - b);

    onChange(newValue);
  }, [preset, customHari, onChange]);

  const toggleCustomHari = (hari: number) => {
    setCustomHari((prev) =>
      prev.includes(hari) ? prev.filter((h) => h !== hari) : [...prev, hari]
    );
  };

  const handlePresetClick = (p: "SEMUA" | "WEEKDAY" | "WEEKEND" | "KUSTOM") => {
    setPreset(p);
    if (p !== "KUSTOM") {
      setCustomHari([]);
    }
  };

  const isHariSelected = (hari: number) => {
    if (preset === "SEMUA") return false;
    if (preset === "WEEKDAY") return [1, 2, 3, 4, 5].includes(hari);
    if (preset === "WEEKEND") return [6, 0].includes(hari);
    return customHari.includes(hari);
  };

  const getDisplayText = () => {
    if (preset === "SEMUA") return "Semua hari (Senin–Minggu)";
    if (preset === "WEEKDAY") return "Weekday: Senin–Jumat";
    if (preset === "WEEKEND") return "Weekend: Sabtu–Minggu";
    if (customHari.length === 0) return "Custom: (belum pilih hari)";
    return `Custom: ${customHari.map((h) => HARI_LABELS[h]).join(", ")}`;
  };

  if (disabled) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">{label ?? "Hari Kerja"}</label>
        <div className="px-3 py-2 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          {getDisplayText()}
        </div>
        <input type="hidden" name="hariKerja" value={JSON.stringify(value)} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium">{label ?? "Hari Kerja"}</label>

      {/* Preset Buttons */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pilih pola hari kerja">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={preset === p.key}
            onClick={() => handlePresetClick(p.key as any)}
            disabled={disabled}
            className={cn(
              "px-3 py-1.5 text-sm rounded-lg border transition-colors font-medium",
              preset === p.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-border hover:bg-muted"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom Checkboxes */}
      {preset === "KUSTOM" && (
        <div className="grid grid-cols-7 gap-2 p-3 bg-muted/30 rounded-lg border border-border">
          {HARI_LABELS.map((label, idx) => (
            <label
              key={idx}
              className={cn(
                "flex flex-col items-center gap-1 cursor-pointer p-2 rounded transition-colors",
                isHariSelected(idx)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              <input
                type="checkbox"
                checked={isHariSelected(idx)}
                onChange={() => toggleCustomHari(idx)}
                disabled={disabled}
                className="sr-only"
                aria-label={HARI_FULL[idx]}
              />
              <span className="text-xs font-medium">{label}</span>
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full border-2 transition-colors",
                  isHariSelected(idx)
                    ? "bg-primary border-primary"
                    : "border-border"
                )}
              />
            </label>
          ))}
        </div>
      )}

      {/* Hidden input untuk form submit */}
      <input type="hidden" name="hariKerja" value={JSON.stringify(value)} />

      {/* Helper text */}
      <p className="text-xs text-muted-foreground">
        {preset === "KUSTOM" && customHari.length === 0
          ? "Pilih minimal 1 hari untuk mode Custom"
          : getDisplayText()}
      </p>
    </div>
  );
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((val, idx) => val === sortedB[idx]);
}