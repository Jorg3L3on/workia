import Image from "next/image";

import { cn } from "@/lib/utils";

type WorkiaMarkProps = {
  className?: string;
};

/** Workia W mark (teal gradient, three-person motif) — no tile behind it. */
export const WorkiaMark = ({ className }: WorkiaMarkProps) => {
  return (
    <Image
      src="/mark.svg"
      alt=""
      width={32}
      height={32}
      className={cn("h-8 w-auto shrink-0 object-contain", className)}
      unoptimized
      priority
    />
  );
};
