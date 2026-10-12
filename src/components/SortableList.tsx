import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { GripIcon } from "./Icons.tsx";

interface Props<T> {
  items: T[];
  keyOf(item: T): string | number;
  /** The row's content. */
  children(item: T, index: number): ReactNode;
  /** When on, each row gets a grab bar on the right for dragging. */
  sorting: boolean;
  onReorder(items: T[]): void;
}

interface Drag {
  index: number;
  target: number;
  startY: number;
  startScroll: number;
  dy: number;
  /** Row tops and heights when the drag began. */
  tops: number[];
  heights: number[];
  gap: number;
}

const EDGE = 70; // px from the top or bottom of the screen where the page starts scrolling
const MAX_SCROLL = 12; // px per frame

/**
 * A list whose rows can be dragged into a new order by their grab bars.
 * Built on pointer events so it works the same with a finger or a mouse,
 * including iOS 15 Safari.
 */
export function SortableList<T>({ items, keyOf, children, sorting, onReorder }: Props<T>) {
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointerY = useRef(0);

  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  function moveTo(clientY: number) {
    const d = dragRef.current;
    if (!d) return;
    pointerY.current = clientY;
    const dy = clientY - d.startY + (window.scrollY - d.startScroll);
    const center = d.tops[d.index] + d.heights[d.index] / 2 + dy;
    let target = 0;
    d.tops.forEach((top, j) => {
      if (j !== d.index && top + d.heights[j] / 2 < center) target++;
    });
    update({ ...d, dy, target });
  }

  // Scroll the page while a row is held near the top or bottom of the screen.
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const step = () => {
      const y = pointerY.current;
      const speed =
        y < EDGE ? -MAX_SCROLL * (1 - y / EDGE) : y > window.innerHeight - EDGE ? MAX_SCROLL * (1 - (window.innerHeight - y) / EDGE) : 0;
      if (speed) {
        window.scrollBy(0, speed);
        moveTo(y);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  function start(e: ReactPointerEvent<HTMLElement>, index: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = rows.current.slice(0, items.length).map((r) => r!.getBoundingClientRect());
    pointerY.current = e.clientY;
    update({
      index,
      target: index,
      startY: e.clientY,
      startScroll: window.scrollY,
      dy: 0,
      tops: rects.map((r) => r.top + window.scrollY),
      heights: rects.map((r) => r.height),
      gap: rects.length > 1 ? rects[1].top - rects[0].bottom : 0,
    });
  }

  function end() {
    const d = dragRef.current;
    update(null);
    if (!d || d.target === d.index) return;
    const next = items.slice();
    const [moved] = next.splice(d.index, 1);
    next.splice(d.target, 0, moved);
    onReorder(next);
  }

  function offset(j: number): number {
    if (!drag) return 0;
    if (j === drag.index) return drag.dy;
    const shift = drag.heights[drag.index] + drag.gap;
    if (drag.index < j && j <= drag.target) return -shift;
    if (drag.target <= j && j < drag.index) return shift;
    return 0;
  }

  return (
    <ul className={`list sortable${drag ? " dragging" : ""}`}>
      {items.map((item, i) => (
        <li
          key={keyOf(item)}
          ref={(el) => {
            rows.current[i] = el;
          }}
          className={`list-item${drag?.index === i ? " lifted" : ""}`}
          style={drag ? { transform: `translateY(${offset(i)}px)` } : undefined}
        >
          {children(item, i)}
          {sorting && (
            <span
              className="grip"
              role="button"
              aria-label="Drag to reorder"
              onPointerDown={(e) => start(e, i)}
              onPointerMove={(e) => moveTo(e.clientY)}
              onPointerUp={end}
              onPointerCancel={end}
            >
              <GripIcon />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
