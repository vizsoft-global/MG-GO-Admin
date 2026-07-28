export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
