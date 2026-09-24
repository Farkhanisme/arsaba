"use client";

import { toast } from "sonner";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  duration?: number;
  variant?:
    | "default"
    | "destructive"
    | "success"
    | "warning"
    | "info";
}

interface ProgressToastOptions {
  message: string;
  progress?: number; // 0-100
  isLoading?: boolean;
  onCancel?: () => void;
}

let actionToastId: string | number | null = null;
let progressToastId: string | number | null = null;

/**
 * Show a toast with an action button (e.g., Undo, Retry, View)
 */
export function showActionToast(options: ActionToastOptions) {
  const { message, actionLabel, onAction, duration = 5000, variant = "default" } = options;

  // Dismiss previous action toast
  if (actionToastId !== null) {
    toast.dismiss(actionToastId);
  }

  actionToastId = toast(message, {
    duration,
    className: cn(
      "flex items-start gap-3 rounded-lg border-2 border-gray-200",
      variant === "destructive" && "border-red-500 bg-red-50 text-red-800",
      variant === "success" && "border-green-500 bg-green-50 text-green-800",
      variant === "warning" && "border-amber-500 bg-amber-50 text-amber-800",
      variant === "info" && "border-blue-500 bg-blue-50 text-blue-800"
    ),
    action: actionLabel && onAction
      ? {
          label: actionLabel,
          onClick: () => {
            onAction();
            if (actionToastId !== null) toast.dismiss(actionToastId);
          },
        }
      : undefined,
    closeButton: true,
    icon: variant === "success" ? (
      <CheckCircle className="h-5 w-5 text-green-500" />
    ) : variant === "destructive" ? (
      <AlertCircle className="h-5 w-5 text-red-500" />
    ) : undefined,
  });

  return actionToastId;
}

/**
 * Show a progress toast for long-running operations
 */
export function showProgressToast(options: ProgressToastOptions) {
  const { message, progress = 0, isLoading = true, onCancel } = options;

  // Dismiss previous progress toast
  if (progressToastId !== null) {
    toast.dismiss(progressToastId);
  }

  const loadingMessage = isLoading 
    ? `${message}${progress > 0 ? ` ${Math.round(progress)}%` : ""}`
    : message;

  progressToastId = toast.loading(loadingMessage, {
    duration: Infinity,
    closeButton: !isLoading,
    action: onCancel
      ? {
          label: "Batal",
          onClick: onCancel,
        }
      : undefined,
    className: "flex items-center gap-3",
    icon: isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : undefined,
  });

  return progressToastId;
}

/**
 * Update progress of an existing progress toast
 */
export function updateProgressToast(progress: number, message?: string) {
  if (progressToastId !== null) {
    toast.dismiss(progressToastId);
    progressToastId = toast.loading(`${message || "Memproses..."} ${Math.round(progress)}%`, {
      duration: Infinity,
      className: "flex items-center gap-3",
      icon: <Loader2 className="h-5 w-5 animate-spin" />,
    });
  }
}

/**
 * Complete a progress toast (success or error)
 */
export function completeProgressToast(success: boolean, message: string) {
  if (progressToastId !== null) {
    toast.dismiss(progressToastId);
    progressToastId = null;
  }
  
  toast[success ? "success" : "error"](message, {
    duration: 4000,
    className: "flex items-center gap-3",
    icon: success 
      ? <CheckCircle className="h-5 w-5 text-green-500" />
      : <AlertCircle className="h-5 w-5 text-red-500" />,
  });
}

/**
 * Dismiss all action/progress toasts
 */
export function dismissAllToasts() {
  if (actionToastId !== null) {
    toast.dismiss(actionToastId);
    actionToastId = null;
  }
  if (progressToastId !== null) {
    toast.dismiss(progressToastId);
    progressToastId = null;
  }
}

/**
 * Hook for using action toasts in components
 */
export function useActionToast() {
  return {
    showAction: showActionToast,
    showProgress: showProgressToast,
    updateProgress: updateProgressToast,
    completeProgress: completeProgressToast,
    dismissAll: dismissAllToasts,
  };
}

/**
 * Show an undo toast (common pattern for delete/archive actions)
 */
export function showUndoToast(message: string, onUndo: () => void, duration = 5000) {
  return showActionToast({
    message,
    actionLabel: "Batal",
    onAction: onUndo,
    duration,
    variant: "destructive",
  });
}

/**
 * Show a retry toast for failed operations
 */
export function showRetryToast(message: string, onRetry: () => void, duration = 8000) {
  return showActionToast({
    message,
    actionLabel: "Coba Lagi",
    onAction: onRetry,
    duration,
    variant: "destructive",
  });
}

/**
 * Show a success toast with action (e.g., "Created" + "View")
 */
export function showSuccessWithAction(message: string, actionLabel: string, onAction: () => void, duration = 5000) {
  return showActionToast({
    message,
    actionLabel,
    onAction,
    duration,
    variant: "success",
  });
}