export function InfoNote({ children }: { children: string }) {
  return (
    <p className="rounded-[var(--radius-sm)] bg-[var(--surface-subtle)] px-2 py-[var(--gap-tight)] text-xs text-[var(--text-secondary)]">
      {children}
    </p>
  );
}