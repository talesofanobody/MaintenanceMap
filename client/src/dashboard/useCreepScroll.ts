import { useEffect, useRef } from "react";

const SCROLL_STEP_MS = 60;

/**
 * Wall displays hold more than fits. Rather than paging — which hides whole chunks for
 * ten seconds at a time — a list keeps everything in one ranked order and creeps down
 * it, pausing at each end so someone glancing up can actually read the top.
 *
 * `dependency` restarts the scroll from the top whenever the content changes.
 * `holdTicks` is how long to rest at each end, in ticks of ~60ms.
 */
export function useCreepScroll<T extends HTMLElement = HTMLDivElement>(dependency: unknown, holdTicks = 40) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    let direction = 1;
    let hold = holdTicks;
    const timer = setInterval(() => {
      const slack = el.scrollHeight - el.clientHeight;
      if (slack <= 4) return;
      if (hold > 0) {
        hold -= 1;
        return;
      }
      el.scrollTop += direction;
      if (el.scrollTop >= slack - 1 || el.scrollTop <= 0) {
        direction *= -1;
        hold = holdTicks;
      }
    }, SCROLL_STEP_MS);
    return () => clearInterval(timer);
  }, [dependency, holdTicks]);

  return ref;
}

export default useCreepScroll;
