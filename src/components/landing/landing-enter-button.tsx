"use client";

import { useRouter } from "next/navigation";

import { ExpandingArrowButton } from "@/components/motion/expanding-arrow-button";
import { cn } from "@/lib/utils";

type LandingEnterButtonProps = {
  className?: string;
};

export const LandingEnterButton = ({ className }: LandingEnterButtonProps) => {
  const router = useRouter();

  const handleClick = () => {
    router.push("/login");
  };

  return (
    <ExpandingArrowButton
      accentClassName="bg-white text-neutral-950"
      aria-label="Entrar"
      className={cn(
        "bg-primary focus-visible:ring-primary h-14 min-w-56 rounded-[18px] text-white",
        className,
      )}
      labelClassName="text-base font-medium"
      onClick={handleClick}
      type="button"
    >
      Entrar
    </ExpandingArrowButton>
  );
};
