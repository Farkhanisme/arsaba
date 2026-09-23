"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
    variant?: "default" | "outline";
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  icon?: React.ReactNode;
  className?: string;
  illustration?: "default" | "search" | "filter" | "create" | "offline";
}

const illustrations = {
  default: (
    <svg className="w-16 h-16 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  search: (
    <svg className="w-16 h-16 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  filter: (
    <svg className="w-16 h-16 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  ),
  create: (
    <svg className="w-16 h-16 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
    </svg>
  ),
  offline: (
    <svg className="w-16 h-16 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
};

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  icon,
  className,
  illustration = "default",
}: EmptyStateProps) {
  const illustrationIcon = icon || illustrations[illustration];

  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-12 px-4", className)}>
      <div className="mb-4">{illustrationIcon}</div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-col sm:flex-row gap-3 items-center justify-center">
          {action && (
            <Button
              variant={action.variant || "default"}
              onClick={action.onClick}
              asChild={!!action.href}
            >
              {action.href ? <Link href={action.href}>{action.label}</Link> : <button type="button">{action.label}</button>}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick} asChild={!!secondaryAction.href}>
              {secondaryAction.href ? <Link href={secondaryAction.href}>{secondaryAction.label}</Link> : <button type="button">{secondaryAction.label}</button>}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyStateCard({
  title,
  description,
  action,
  secondaryAction,
  icon,
  illustration = "default",
  className,
}: Omit<EmptyStateProps, "className"> & { className?: string }) {
  return (
    <div className={cn("border rounded-lg p-8 bg-card", className)}>
      <EmptyState
        title={title}
        description={description}
        action={action}
        secondaryAction={secondaryAction}
        icon={icon}
        illustration={illustration}
      />
    </div>
  );
}