"use client";

import { cn } from "@/lib/utils";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <div 
      className={cn(
        "animate-in fade-in-0 duration-300 ease-out",
        className
      )}
      style={{
        viewTransitionName: "page-content",
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}