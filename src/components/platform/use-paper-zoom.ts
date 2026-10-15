"use client";

import { useEffect, useState, type RefObject } from "react";

/** Start with a comfortable sheet; explicit fitting and manual zoom remain separate choices. */
export function usePaperZoom(host: RefObject<HTMLDivElement | null>, width: number, active = true) {
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [fitWidth, setFitWidth] = useState(false);
  const [viewport, setViewport] = useState({ available: 0, window: 0 });
  useEffect(() => {
    const element = host.current;
    if (!active || !element) return;
    const resize = () => {
      const style = getComputedStyle(element);
      const available =
        element.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      setViewport({ available, window: window.innerWidth });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [host, active]);
  const defaultWidth = viewport.window > 760 ? viewport.window / 2 : viewport.available;
  const fittedWidth = fitWidth ? viewport.available : Math.min(viewport.available, defaultWidth);
  const zoom = manualZoom ?? (fittedWidth > 0 ? fittedWidth / width : 0.75);
  return {
    zoom,
    fitWidth,
    setZoom: (value: number) => {
      setManualZoom(value);
      setFitWidth(false);
    },
    fitToWidth: () => {
      setManualZoom(null);
      setFitWidth(true);
    },
  };
}
