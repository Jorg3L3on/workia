"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchManagerOptionsAction,
  type ManagerOption,
} from "@/lib/people/actions";

const SEARCH_DEBOUNCE_MS = 250;

type ManagerPickerProps = {
  id: string;
  name: string;
  initial: ManagerOption | null;
  /** The person being edited, who cannot be their own manager. */
  excludeId?: string;
  /** Where options come from; defaults to active people (people:read). */
  search?: (query: string, excludeId?: string) => Promise<ManagerOption[]>;
  /** Shown in the empty field. */
  placeholder?: string;
  /** Text before the chosen name under the field. */
  selectedPrefix?: string;
};

/** Search-as-you-type manager field; submits the chosen id under `name`. */
export const ManagerPicker = ({
  id,
  name,
  initial,
  excludeId,
  search = searchManagerOptionsAction,
  placeholder = "Sin jefe directo",
  selectedPrefix = "Jefe directo actual",
}: ManagerPickerProps) => {
  const listId = useId();
  const [selected, setSelected] = useState<ManagerOption | null>(initial);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<ManagerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    const request = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);

      try {
        const found = await search(text, excludeId);

        if (request === requestRef.current) {
          setOptions(found);
        }
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [text, open, excludeId, search]);

  const choose = (option: ManagerOption | null) => {
    setSelected(option);
    setText("");
    setOpen(false);
  };

  return (
    <div className="relative space-y-2">
      <input name={name} type="hidden" value={selected?.id ?? ""} />
      <div className="flex items-center gap-2">
        <Input
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          autoComplete="off"
          id={id}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selected ? selected.label : placeholder}
          role="combobox"
          value={text}
        />
        {selected ? (
          <Button
            onClick={() => choose(null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Quitar
          </Button>
        ) : null}
      </div>
      {selected ? (
        <p className="text-muted-foreground text-xs">
          {selectedPrefix}: {selected.label}
        </p>
      ) : null}
      {open ? (
        <ul
          className="bg-popover absolute z-20 max-h-60 w-full overflow-auto rounded-lg border p-1 shadow-md"
          id={listId}
          role="listbox"
        >
          {loading && options.length === 0 ? (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">
              Buscando…
            </li>
          ) : options.length === 0 ? (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">
              Sin resultados
            </li>
          ) : (
            options.map((option) => (
              <li key={option.id} role="presentation">
                <button
                  aria-selected={option.id === selected?.id}
                  className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  role="option"
                  type="button"
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
};
