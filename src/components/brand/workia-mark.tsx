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
      width={32}
      height={32}
      className={cn("size-8 shrink-0 rounded-[9px] object-contain", className)}
      unoptimized
      priority
    />
  );
};
