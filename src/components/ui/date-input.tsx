"use client";

import { useId, useState, type ChangeEvent, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import {
  DATE_DISPLAY_PLACEHOLDER,
  formatDateMx,
  parseFlexibleDateToIso,
} from "@/lib/format/date";

type DateInputProps = Omit<
  ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  name: string;
  defaultValue?: string;
};

export const DateInput = ({
  id,
  name,
  defaultValue = "",
  required,
  placeholder = DATE_DISPLAY_PLACEHOLDER,
  ...props
}: DateInputProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const initialIso = parseFlexibleDateToIso(defaultValue) ?? "";
  const [iso, setIso] = useState(initialIso);
  const [display, setDisplay] = useState(
    initialIso ? formatDateMx(initialIso, "") : "",
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setDisplay(next);
    setIso(parseFlexibleDateToIso(next) ?? "");
  };

  const handleBlur = () => {
    if (iso) {
      setDisplay(formatDateMx(iso, ""));
    }
  };

  return (
    <>
      <input name={name} type="hidden" value={iso} />
      <Input
        {...props}
        autoComplete="off"
        id={inputId}
        inputMode="numeric"
        lang="es-MX"
        onBlur={handleBlur}
        onChange={handleChange}
        placeholder={placeholder}
        required={required}
        title="Día/mes/año"
        type="text"
        value={display}
      />
    </>
  );
};
