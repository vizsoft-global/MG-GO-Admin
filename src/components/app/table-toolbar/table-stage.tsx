"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Pins the toolbar and reports its height so the header can stick just under it. */
export function TableStage({
  toolbar,
  children,
}: {
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const node = barRef.current;
    if (!node) return;
    const measure = () => setOffset(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [toolbar]);

  return (
    <div style={{ ["--table-toolbar-offset" as string]: `${offset}px` }}>
      <div
        ref={barRef}
        data-table-toolbar=""
        className="sticky top-0 z-30 border-b border-[var(--border-default)] bg-card"
      >
        {toolbar}
      </div>
      {children}
    </div>
  );
}
