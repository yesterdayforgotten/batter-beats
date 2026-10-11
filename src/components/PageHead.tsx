import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BackIcon } from "./Icons.tsx";

export function PageHead({ back, eyebrow, title, right }: { back: string; eyebrow?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-head">
      <Link to={back} className="back" aria-label="Back">
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
