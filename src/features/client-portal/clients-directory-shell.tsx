"use client";

import { Link } from "@/i18n/navigation";
import { Eye, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const card = "rounded-xl border border-[var(--portal-border)] bg-[var(--portal-canvas)] p-4";

// TODO: mock until a portal catalog exists
const MOCK_KPIS = {
  activePortals: 4,
  clientUsers: 8,
  ridersVisible: 829,
  documentViews7d: 146,
} as const;

// TODO: mock until a portal catalog exists
const MOCK_PORTALS = [
  { id: "keeta", name: "Keeta", slug: "keeta", riders: 207, status: "active" as const },
  { id: "americana", name: "Americana", slug: "americana", riders: 622, status: "active" as const },
  { id: "talabat", name: "Talabat", slug: "talabat", riders: 0, status: "draft" as const },
  { id: "uber-eats", name: "Uber Eats", slug: "uber-eats", riders: 0, status: "draft" as const },
];

export function ClientsDirectoryShell() {
  return (
    <div className="min-h-0 space-y-4 bg-[var(--portal-canvas)] p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-h1 text-[var(--portal-ink)]">Client portals</h1>
          <p className="text-sm text-[var(--portal-muted)]">Manage partner access to rider documents and dashboards.</p>
        </div>
        <Button variant="portal" className="h-9 cursor-pointer" render={<Link href="/client-portal/new" />}>
          <Plus className="size-4" />
          New client portal
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard layout="portal" portalAccent="plum" label="Active portals" value={MOCK_KPIS.activePortals} />
        <KpiCard layout="portal" portalAccent="blue" label="Client users" value={MOCK_KPIS.clientUsers} />
        <KpiCard layout="portal" portalAccent="green" label="Riders visible to clients" value={MOCK_KPIS.ridersVisible} />
        <KpiCard layout="portal" portalAccent="ochre" label="Document views (7 days)" value={MOCK_KPIS.documentViews7d} />
      </div>

      <section className={card}>
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>Client</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>Riders</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>Status</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_PORTALS.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-[var(--portal-ink)]">{row.name}</TableCell>
                <TableCell>{row.riders > 0 ? row.riders : "—"}</TableCell>
                <TableCell>
                  <Badge variant={row.status === "active" ? "portal-green" : "portal-grey"}>
                    {row.status === "active" ? "Active" : "Draft"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {row.slug === "keeta" || row.slug === "americana" ? (
                    <Button variant="portal-secondary" className="h-9 cursor-pointer" render={<Link href={`/client-portal/preview/${row.slug}`} />}>
                      <Eye className="size-4" />
                      Preview
                    </Button>
                  ) : (
                    <span className="text-xs text-[var(--portal-muted)]">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
