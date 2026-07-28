import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppDataTableEmpty, AppEmptyState } from "@/components/app";

export function DataTableShell({
  columns,
  emptyTitle,
  emptyDescription,
  skeletonRows = 5,
}: {
  columns: string[];
  emptyTitle: string;
  emptyDescription?: string;
  skeletonRows?: number;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border-border shadow-sm">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              {columns.map((col) => (
                <TableHead key={col} className={TABLE_HEAD_CLASS}>
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={i} className="hover:bg-muted/40">
                {columns.map((col) => (
                  <TableCell key={col}>
                    <Skeleton className="h-4 w-full max-w-[140px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <AppDataTableEmpty>
          <AppEmptyState title={emptyTitle} description={emptyDescription} />
        </AppDataTableEmpty>
      </CardContent>
    </Card>
  );
}
