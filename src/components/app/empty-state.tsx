export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-default)] bg-[var(--surface-subtle)] px-[var(--pad-card)] py-[var(--pad-card)] text-center">
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      {description ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{description}</p> : null}
    </div>
  );
}
