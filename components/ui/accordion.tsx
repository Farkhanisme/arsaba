"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AccordionProps {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  children: React.ReactNode;
  className?: string;
}

interface AccordionItemProps {
  value: string;
  trigger: React.ReactNode;
  content: React.ReactNode;
  className?: string;
}

const AccordionContext = React.createContext<{
  type: "single" | "multiple";
  value: string[];
  onValueChange: (value: string) => void;
  registerTrigger: (value: string, element: HTMLButtonElement | null) => void;
} | null>(null);

function useAccordionContext() {
  const context = React.useContext(AccordionContext);
  if (!context) {
    throw new Error("Accordion components must be used within Accordion");
  }
  return context;
}

export function Accordion({
  type = "single",
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className,
}: AccordionProps) {
  const isControlled = controlledValue !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = React.useState<string[]>(
    defaultValue ? (Array.isArray(defaultValue) ? defaultValue : [defaultValue]) : []
  );

  const value = isControlled ? controlledValue : uncontrolledValue;
  const valueArray = Array.isArray(value) ? value : value ? [value] : [];

  const handleValueChange = React.useCallback(
    (itemValue: string) => {
      let newValue: string[];
      if (type === "multiple") {
        newValue = valueArray.includes(itemValue)
          ? valueArray.filter((v) => v !== itemValue)
          : [...valueArray, itemValue];
      } else {
        newValue = valueArray.includes(itemValue) ? [] : [itemValue];
      }

      if (!isControlled) {
        setUncontrolledValue(newValue);
      }
      onValueChange?.(type === "multiple" ? newValue : newValue[0] as string);
    },
    [valueArray, type, isControlled]
  );

  return (
    <AccordionContext.Provider value={{ type, value: valueArray, onValueChange: handleValueChange, registerTrigger: () => {} }}>
      <div data-slot="accordion" className={cn("w-full", className)}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({
  value,
  trigger,
  content,
  className,
}: AccordionItemProps) {
  const { type, value: contextValue, onValueChange } = useAccordionContext();
  const isOpen = contextValue.includes(value);
  const [isAnimating, setIsAnimating] = React.useState(false);

  const handleTriggerClick = () => {
    onValueChange(value);
  };

  return (
    <div
      data-slot="accordion-item"
      className={cn("border rounded-lg overflow-hidden", className)}
    >
      <AccordionTrigger
        value={value}
        isOpen={isOpen}
        onClick={handleTriggerClick}
        disabled={isAnimating}
      >
        {trigger}
      </AccordionTrigger>
      {content && (
        <AccordionContent value={value} isOpen={isOpen} onAnimationEnd={() => setIsAnimating(false)}>
          {content}
        </AccordionContent>
      )}
    </div>
  );
}

export function AccordionTrigger({
  value,
  isOpen,
  onClick,
  disabled,
  children,
  className,
}: {
  value: string;
  isOpen: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "w-full justify-between py-3 px-4 text-left font-medium hover:bg-muted/50 transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "data-[state=open]:bg-muted",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={isOpen}
      aria-controls={`accordion-content-${value}`}
      data-state={isOpen ? "open" : "closed"}
      data-slot="accordion-trigger"
    >
      {children}
      <ChevronDown
        className={cn(
          "h-4 w-4 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-180"
        )}
        aria-hidden="true"
      />
    </Button>
  );
}

function AccordionContent({
  value,
  isOpen,
  children,
  onAnimationEnd,
  className,
}: {
  value: string;
  isOpen: boolean;
  children: React.ReactNode;
  onAnimationEnd?: () => void;
  className?: string;
}) {
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!contentRef.current) return;
    
    const content = contentRef.current;
    if (isOpen) {
      content.style.maxHeight = content.scrollHeight + "px";
      content.style.opacity = "1";
    } else {
      content.style.maxHeight = "0px";
      content.style.opacity = "0";
    }
  }, [isOpen]);

  return (
    <div
      ref={contentRef}
      id={`accordion-content-${value}`}
      role="region"
      aria-labelledby={`accordion-trigger-${value}`}
      className={cn(
        "overflow-hidden transition-all duration-200 ease-out",
        isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0",
        className
      )}
      onTransitionEnd={onAnimationEnd}
      data-state={isOpen ? "open" : "closed"}
      data-slot="accordion-content"
    >
      <div className="px-4 pb-4 pt-2 text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  );
}