import * as React from "react"
import { cn } from "cn"

// Select native dengan tinggi & radius selaras Input (h-8) — dipakai untuk
// semua dropdown form agar baris field sejajar (ganti select inline h-10).
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none input-focus-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Select }
