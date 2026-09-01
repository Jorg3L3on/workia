"use client";

import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NONE_VALUE = "__none__";

export type FormSelectOption = {
  value: string;
  label: string;
};

type FormSelectProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  options: FormSelectOption[];
  onValueChange?: (value: string) => void;
  "aria-label"?: string;
  className?: string;
  triggerClassName?: string;
  required?: boolean;
  disabled?: boolean;
  /** `filter` matches list toolbars; `field` matches form controls. */
  variant?: "filter" | "field";
};

const toSelectValue = (value: string) => (value === "" ? NONE_VALUE : value);
const fromSelectValue = (value: string) => (value === NONE_VALUE ? "" : value);

export const FormSelect = ({
  id,
  name,
  value,
  defaultValue = "",
  placeholder,
  options,
  onValueChange,
  "aria-label": ariaLabel,
  className,
  triggerClassName,
  required,
  disabled,
  variant = "filter",
}: FormSelectProps) => {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const current = isControlled ? value : internalValue;

  const handleValueChange = (next: string) => {
    const normalized = fromSelectValue(next);
    if (!isControlled) {
      setInternalValue(normalized);
    }
    onValueChange?.(normalized);
  };

  return (
    <div className={cn("w-full", className)}>
      {name ? <input name={name} type="hidden" value={current} /> : null}
      <Select
        disabled={disabled}
        onValueChange={handleValueChange}
        required={required}
        value={toSelectValue(current)}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          className={cn(
            "bg-card w-full",
            variant === "filter"
              ? "h-10 rounded-xl data-[size=default]:h-10"
              : "h-8 rounded-lg data-[size=default]:h-8 data-[size=sm]:h-8",
            triggerClassName,
          )}
          id={id}
          size={variant === "filter" ? "default" : "sm"}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem
              key={`${option.value || NONE_VALUE}-${option.label}`}
              value={toSelectValue(option.value)}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
