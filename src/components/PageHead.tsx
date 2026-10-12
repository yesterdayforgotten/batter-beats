import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackIcon } from "./Icons.tsx";

export function PageHead({
  back,
  onBack,
  eyebrow,
  title,
  right,
}: {
  back: string;
  /** Replaces following the link, e.g. to leave a mode on the same page. */
  onBack?: () => void;
  eyebrow?: string;
  title?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="page-head">
      <Link
        to={back}
        className="back"
        aria-label="Back"
        onClick={
          onBack &&
          ((e) => {
            e.preventDefault();
            onBack();
          })
        }
      >
        <BackIcon />
      </Link>
      <div className="title">
        {eyebrow && <div className="eyebrow truncate">{eyebrow}</div>}
        {title}
      </div>
      {right}
    </header>
  );
}
