import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackIcon } from "./Icons.tsx";

export function PageHead({
  back,
  onBack,
  eyebrow,
  title,
  right,
  done,
}: {
  /** Where the back arrow goes; no arrow when left out (screens whose way back is the app bar's Teams link). */
  back?: string;
  /** Replaces following the link, e.g. to leave a mode on the same page. */
  onBack?: () => void;
  eyebrow?: string;
  title?: ReactNode;
  right?: ReactNode;
  /** Edit screens: a Done link at the top right (instead of a back arrow) that returns here. */
  done?: string;
}) {
  return (
    <header className={`page-head${back === undefined ? " no-back" : ""}`}>
      {back !== undefined && (
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
      )}
      <div className="title">
        {eyebrow && <div className="eyebrow truncate">{eyebrow}</div>}
        {title}
      </div>
      {right}
      {done !== undefined && (
        <Link to={done} className="link-button head-done">
          Done
        </Link>
      )}
    </header>
  );
}
