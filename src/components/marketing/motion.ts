"use client";

import { useEffect, useState, type RefObject } from "react";

/** Every animation on the page holds its final frame when the visitor asks for reduced motion. */
function prefersStill() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Steps forward on a timer, and holds the last frame when motion is reduced. */
export function useCycle(length: number, interval = 2600) {
  const [index, setIndex] = useState<number | "still">("still");
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (prefersStill()) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current === "still" ? 0 : (current + 1) % length));
    }, interval);
    const onChange = () => {
      if (media.matches) {
        window.clearInterval(timer);
        setIndex("still");
      }
    };
    media.addEventListener("change", onChange);
    return () => {
      window.clearInterval(timer);
      media.removeEventListener("change", onChange);
    };
  }, [interval, length]);
  return index === "still" ? length - 1 : index;
}

/**
 * Counts up from 0 to `total` once the element scrolls into view, one step per `interval`.
 * Returns `total` straight away when motion is reduced.
 */
export function useInViewSequence(ref: RefObject<HTMLElement | null>, total: number, interval = 900) {
  const [count, setCount] = useState<number | "still">("still");
  useEffect(() => {
    const node = ref.current;
    if (!node || prefersStill()) return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setCount(0);
        timer = window.setInterval(() => {
          setCount((current) => {
            const next = (current === "still" ? total : current) + 1;
            if (next >= total && timer) window.clearInterval(timer);
            return Math.min(next, total);
          });
        }, interval);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer) window.clearInterval(timer);
    };
  }, [interval, ref, total]);
  return count === "still" ? total : count;
}
