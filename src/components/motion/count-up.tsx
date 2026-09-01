"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

type CountUpProps = {
  value: number;
  className?: string;
};

export const CountUp = ({ value, className }: CountUpProps) => {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }

    const started = performance.now();
    const duration = 520;
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(value * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduceMotion]);

  return <span className={className}>{reduceMotion ? value : shown}</span>;
};
