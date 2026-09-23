"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TimePickerProps {
  value: string; // "HH:mm"
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  error?: string;
  required?: boolean;
  id?: string;
}

export function TimePicker({ value, onChange, disabled, label, error, required, id }: TimePickerProps) {
  const [hour, setHour] = useState(() => value.split(":")[0] || "07");
  const [minute, setMinute] = useState(() => value.split(":")[1] || "00");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputId = id || `time-picker-${Math.random().toString(36).slice(2)}`;

  // Sync internal state with props
  useEffect(() => {
    const [h, m] = value.split(":");
    if (h) setHour(h);
    if (m) setMinute(m);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleHourChange = useCallback((delta: number) => {
    setHour((prev) => {
      const newHour = (Number(prev) + delta + 24) % 24;
      return String(newHour).padStart(2, "0");
    });
  }, []);

  const handleMinuteChange = useCallback((delta: number) => {
    setMinute((prev) => {
      const newMinute = (Number(prev) + delta + 60) % 60;
      return String(newMinute).padStart(2, "0");
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const newValue = `${hour}:${minute}`;
    onChange(newValue);
    setOpen(false);
  }, [hour, minute, onChange]);

  const handleInputClick = useCallback(() => {
    if (!disabled) setOpen(true);
  }, [disabled]);

  const formattedValue = `${hour}:${minute}`;

  return (
    <div className="relative" ref={ref}>
      <Label htmlFor={inputId} className="text-sm font-medium">
        {label ?? "Waktu"}
        {required && <span className="text-destructive ml-1" aria-hidden="true">*</span>}
      </Label>

      <div className="relative">
        <Input
          id={inputId}
          readOnly
          value={formattedValue}
          onClick={handleInputClick}
          disabled={disabled}
          className={cn("cursor-pointer", error && "border-destructive focus-visible:ring-destructive")}
          placeholder="HH:mm"
          aria-haspopup="dialog"
          aria-expanded={open}
        />

        {open && !disabled && (
          <div
            className="absolute z-50 mt-1 w-full max-w-xs rounded-md border bg-popover p-2 shadow-lg animate-in fade-in-0 zoom-in-95"
            role="dialog"
            aria-label="Pilih waktu"
          >
            <div className="flex items-center gap-2">
              {/* Hour */}
              <div className="flex flex-col items-center gap-1 flex-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleHourChange(-1)}
                  aria-label="Jam sebelumnya"
                  disabled={disabled}
                >
                  ▲
                </Button>
                <span className="text-lg font-mono tabular-nums w-10 text-center" aria-live="polite">{hour}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleHourChange(1)}
                  aria-label="Jam berikutnya"
                  disabled={disabled}
                >
                  ▼
                </Button>

                <span className="text-lg text-muted-foreground">:</span>

                {/* Minute */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleMinuteChange(-1)}
                  aria-label="Menit sebelumnya"
                  disabled={disabled}
                >
                  ▲
                </Button>
                <span className="text-lg font-mono tabular-nums w-10 text-center" aria-live="polite">{minute}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleMinuteChange(1)}
                  aria-label="Menit berikutnya"
                  disabled={disabled}
                >
                  ▼
                </Button>
              </div>
            </div>

            <div className="flex gap-2 mt-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleConfirm}
                disabled={disabled}
              >
                OK
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={disabled}
              >
                Batal
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive mt-1" role="alert">{error}</p>}
    </div>
  );
}