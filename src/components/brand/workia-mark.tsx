import Image from "next/image";

import { cn } from "@/lib/utils";

type WorkiaMarkProps = {
  className?: string;
};

/** Ribbon W mark only — no dark squircle tile. */
export const WorkiaMark = ({ className }: WorkiaMarkProps) => {
  return (
    <Image
      src="/mark.png"
      alt=""
      width={48}
      height={32}
      className={cn("h-8 w-auto shrink-0 object-contain", className)}
      unoptimized
      priority
    />
  );
};
