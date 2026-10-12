import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { KebabIcon } from "./Icons.tsx";

export type MenuItem = { label: string; onSelect: () => void } | { label: string; to: string; onSelect?: () => void };

/** A ⋮ (or other) button and its small menu. Tapping outside closes it. */
export function MoreMenu({ items, icon = <KebabIcon />, label = "More" }: { items: MenuItem[]; icon?: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="more-menu" ref={ref}>
      <button className="kebab" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((item) =>
            "to" in item ? (
              <Link
                key={item.label}
                to={item.to}
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
