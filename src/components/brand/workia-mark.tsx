import Image from "next/image";

import { cn } from "@/lib/utils";

type WorkiaMarkProps = {
  className?: string;
};

/** Chosen ribbon-W app icon — dark squircle with blue-to-violet 3D mark. */
export const WorkiaMark = ({ className }: WorkiaMarkProps) => {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={40}
      height={40}
      className={cn(
        "size-10 shrink-0 rounded-[11px] object-contain shadow-[0_4px_12px_-4px_rgba(79,172,254,0.45)]",
        className,
      )}
      unoptimized
      priority
    />
  );
};
