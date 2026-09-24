"use client";

import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useMemo } from "react";

interface Column<T> {
  key: string;
  header: string;
  accessor: (item: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyAccessor: (item: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  emptyAction?: {
    label: string;
    onClick: () => void;
  };
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (key: string) => void;
  rowClassName?: (item: T) => string;
  striped?: boolean;
  hoverable?: boolean;
  compact?: boolean;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  keyAccessor,
  loading = false,
  emptyMessage = "Tidak ada data",
  emptyAction,
  sortBy,
  sortOrder,
  onSort,
  rowClassName,
  striped = true,
  hoverable = true,
  compact = false,
  className,
}: DataTableProps<T>) {
  const sortedData = useMemo(() => {
    if (!sortBy || !onSort) return data;
    return [...data].sort((a, b) => {
      const aVal = String(columns.find(c => c.key === sortBy)?.accessor(a) ?? "");
      const bVal = String(columns.find(c => c.key === sortBy)?.accessor(b) ?? "");
      const direction = sortOrder === "asc" ? 1 : -1;
      return aVal.localeCompare(bVal, "id", { numeric: true }) * direction;
    });
  }, [data, sortBy, sortOrder, columns, onSort]);

  if (loading) {
    return (
      <div className={cn("overflow-x-auto", className)}>
        <SkeletonTable rows={5} columns={columns.length} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn("py-12 text-center", className)}>
        <p className="text-muted-foreground">{emptyMessage}</p>
        {emptyAction && (
          <Button variant="outline" className="mt-4" onClick={emptyAction.onClick}>
            {emptyAction.label}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm" role="grid">
        <thead>
          <tr className={cn("border-b", "bg-muted/50")}>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-3 py-2 text-left font-medium text-muted-foreground",
                  "whitespace-nowrap",
                  column.sortable && "cursor-pointer select-none hover:bg-muted",
                  column.headerClassName
                )}
                style={{ width: column.width }}
                onClick={column.sortable && onSort ? () => onSort(column.key) : undefined}
                aria-sort={sortBy === column.key ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                <div className="flex items-center gap-1">
                  {column.header}
                  {column.sortable && onSort && (
                    <span className="inline-flex items-center">
                      {sortBy === column.key ? (
                        sortOrder === "asc" ? (
                          <ChevronUp className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-primary" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={cn("divide-y", striped && "even:bg-muted/30")}>
          {sortedData.map((item) => (
            <tr
              key={keyAccessor(item)}
              className={cn(
                hoverable && "hover:bg-muted/50 transition-colors",
                rowClassName?.(item)
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-3",
                    "whitespace-nowrap",
                    column.className
                  )}
                >
                  {column.accessor(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SimpleTableProps<T> {
  data: T[];
  columns: { key: string; header: string; render: (item: T) => React.ReactNode }[];
  keyAccessor: (item: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  striped?: boolean;
  hoverable?: boolean;
  className?: string;
}

export function SimpleTable<T>({
  data,
  columns,
  keyAccessor,
  loading = false,
  emptyMessage = "Tidak ada data",
  striped = true,
  hoverable = true,
  className,
}: SimpleTableProps<T>) {
  if (loading) {
    return (
      <div className={className}>
        <SkeletonTable rows={5} columns={columns.length} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn("py-12 text-center", className)}>
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {columns.map((col) => (
              <th key={col.key} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={cn("divide-y", striped && "even:bg-muted/30")}>
          {data.map((item) => (
            <tr key={keyAccessor(item)} className={cn(hoverable && "hover:bg-muted/50")}>
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-3 whitespace-nowrap">
                  {col.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}