export function ErrorState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--status-absent-fg)] bg-[var(--status-absent-bg)] px-[var(--pad-card)] py-4">
      <p className="text-sm font-semibold text-[var(--status-absent-fg)]">{title}</p>
      {description ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{description}</p> : null}
    </div>
  );
}
