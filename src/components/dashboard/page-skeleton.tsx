import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton({
  kpiCount = 6,
  tableRows = 6,
  columns = 5,
  showTabs = true,
}: {
  kpiCount?: number;
  tableRows?: number;
  columns?: number;
  showTabs?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {showTabs ? (
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: kpiCount }).map((_, i) => (
          <Card key={i} className="rounded-xl border-border shadow-sm">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden rounded-xl border-border shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-20" />
              ))}
            </div>
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: tableRows }).map((_, rowIdx) => (
              <div key={rowIdx} className="px-4 py-4">
                <div
                  className="grid gap-4"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: columns }).map((_, colIdx) => (
                    <Skeleton key={colIdx} className="h-4 w-full max-w-[140px]" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
