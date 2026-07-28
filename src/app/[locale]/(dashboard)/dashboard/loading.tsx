import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardHomeLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid min-w-[720px] grid-cols-2 gap-4 sm:min-w-0 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        {Array.from({ length: 9 }).map((_, i) => (
          <Card key={i} className="rounded-xl border-border shadow-sm">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="min-h-[280px] rounded-xl border-border shadow-sm">
            <CardContent className="p-4">
              <Skeleton className="mb-4 h-4 w-40" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
