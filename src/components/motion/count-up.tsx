"use client";

import { useEffect, useState } from "react";
import { useHydratedReducedMotion } from "@/hooks/use-hydrated-reduced-motion";

type CountUpProps = {
  value: number;
  className?: string;
};

export const CountUp = ({ value, className }: CountUpProps) => {
  const reduceMotion = useHydratedReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }

    let cancelled = false;
    const started = performance.now();
    const duration = 520;
    let frame = 0;

    const tick = (now: number) => {
      if (cancelled) {
        return;
      }

      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(value * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [value, reduceMotion]);

  return <span className={className}>{reduceMotion ? value : shown}</span>;
};
