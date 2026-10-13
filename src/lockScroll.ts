import { useEffect } from "react";

// Older iPhones (iOS 15) ignore `overflow: hidden` on the page for touch
// scrolling, so a swipe on an open sheet could scroll the page behind it
// instead. Pinning the page in place (position: fixed, at its current scroll
// position) works everywhere; the scroll position is put back afterwards.

let locks = 0;
let savedY = 0;

function lock() {
  if (locks++ > 0) return;
  savedY = window.scrollY;
  const b = document.body.style;
  b.position = "fixed";
  b.top = `-${savedY}px`;
  b.left = "0";
  b.right = "0";
  b.overflow = "hidden";
}

function unlock() {
  if (--locks > 0) return;
  const b = document.body.style;
  b.position = b.top = b.left = b.right = b.overflow = "";
  window.scrollTo(0, savedY);
}

/** Stops the page behind a sheet from scrolling while the sheet is open, so swipes go to the sheet. */
export function useLockPageScroll() {
  useEffect(() => {
    lock();
    return unlock;
  }, []);
}
