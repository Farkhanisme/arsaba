"use client";

import { cn } from "@/lib/utils";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { forwardRef, useState } from "react";

interface LoadingButtonProps extends Omit<ButtonProps, "disabled"> {
  loading?: boolean;
  loadingText?: string;
  successText?: string;
  successDuration?: number;
  onSuccess?: () => void;
  disabled?: boolean;
}

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  (
    {
      loading,
      loadingText = "Memproses...",
      successText,
      successDuration = 2000,
      onSuccess,
      disabled,
      children,
      className,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    if (loading) {
      return (
        <Button
          ref={ref}
          disabled={true}
          className={cn(className)}
          {...props}
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          {loadingText}
        </Button>
      );
    }

    const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
      if (props.onClick) {
        await props.onClick(e);
      }

      if (successText && !e.defaultPrevented) {
        // Note: This is a simplified version. For full success state,
        // you'd need to manage state in the parent component.
      }
    };

    return (
      <Button
        ref={ref}
        disabled={isDisabled}
        onClick={handleClick}
        className={cn(className)}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

LoadingButton.displayName = "LoadingButton";

// Enhanced version with success state management
interface AsyncButtonProps extends Omit<ButtonProps, "disabled" | "onClick"> {
  onClick: () => Promise<void>;
  loadingText?: string;
  successText?: string;
  errorText?: string;
  resetDelay?: number;
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export function AsyncButton({
  onClick,
  loadingText = "Memproses...",
  successText,
  errorText,
  resetDelay = 2000,
  children,
  disabled,
  className,
  icon,
  ...props
}: AsyncButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleClick = async () => {
    if (state === "loading" || disabled) return;

    setState("loading");
    try {
      await onClick();
      if (successText) {
        setState("success");
        setTimeout(() => setState("idle"), resetDelay);
      } else {
        setState("idle");
      }
    } catch (err) {
      if (errorText) {
        setState("error");
        setTimeout(() => setState("idle"), resetDelay);
      } else {
        setState("idle");
      }
    }
  };

  const displayText = 
    state === "loading" ? loadingText :
    state === "success" ? successText :
    state === "error" ? errorText :
    children;

  const displayIcon = 
    state === "loading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :
    state === "success" ? <Check className="mr-2 h-4 w-4" /> :
    state === "error" ? <AlertCircle className="mr-2 h-4 w-4" /> :
    icon;

  return (
    <Button
      disabled={disabled || state === "loading"}
      onClick={handleClick}
      className={className}
      {...props}
    >
      {displayIcon}
      {displayText}
    </Button>
  );
}