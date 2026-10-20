import { useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// useReducedMotion reads matchMedia, so it is null on the server and true on
// a reduced-motion client during hydration. Report false until hydration is
// done so the first client render matches the server HTML.
export const useHydratedReducedMotion = () => {
  const reduce = useReducedMotion();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return hydrated && reduce === true;
};
