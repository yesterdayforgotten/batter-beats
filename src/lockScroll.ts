import { useEffect } from "react";

/** Stops the page behind a sheet from scrolling while the sheet is open, so swipes go to the sheet. */
export function useLockPageScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = before;
    };
  }, []);
}
