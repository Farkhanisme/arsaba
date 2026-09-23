"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className,
  variant = "text",
  width,
  height,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-muted overflow-hidden",
        {
          "rounded-full": variant === "circular",
          "rounded-lg": variant === "rectangular",
        },
        className
      )}
      style={{
        width: width ? (typeof width === "number" ? `${width}px` : width) : undefined,
        height: height ? (typeof height === "number" ? `${height}px` : height) : undefined,
        minWidth: variant === "text" ? "40px" : undefined,
        minHeight: variant === "text" ? "1rem" : undefined,
      }}
      {...props}
    />
  );
}

export function SkeletonCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-4 p-4", className)} {...props}>
      <Skeleton variant="rectangular" width="60%" height="1.5rem" />
      <Skeleton variant="rectangular" width="40%" height="1rem" />
      <Skeleton variant="rectangular" width="80%" height="1rem" />
      <Skeleton variant="rectangular" width="50%" height="1rem" />
      <Skeleton variant="rectangular" width="100%" height="4rem" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="pb-2 text-left">
                <Skeleton variant="text" width="80%" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {Array.from({ length: rows }).map((_, row) => (
            <tr key={row} className="hover:bg-muted/50">
              {Array.from({ length: columns }).map((_, col) => (
                <td key={col} className="py-3">
                  <Skeleton variant="text" width="90%" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonList({ items = 4 }: { items?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="50%" />
            <Skeleton variant="text" width="30%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton variant="rectangular" className="h-20" />
        <Skeleton variant="rectangular" className="h-20" />
        <Skeleton variant="rectangular" className="h-20" />
      </div>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}