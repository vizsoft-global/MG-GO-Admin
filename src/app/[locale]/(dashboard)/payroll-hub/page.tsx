import { setRequestLocale, getTranslations } from "next-intl/server";
import { BarChart3, FileSpreadsheet, Scale, Wallet } from "lucide-react";
import { AppHubShell, HUB_GLYPH_TINTS, type HubGroup } from "@/components/app/app-hub-shell";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * Payroll Hub — the same Figma shell as Visit bookings (`AppHubShell`).
 *
 * Its two panels are the two halves of the money conversation: what happened
 * (performance and the AM-vs-MGGO reconciliation) beside what is paid for it
 * (Payroll and HR Payroll). Both were previously one flat card grid, which made
 * the read order arbitrary.
 */
const HUB_PERMISSIONS = [
  "payroll.view",
  "performance.view",
  "order_recon.view",
  "payroll.hr_payroll",
  "payroll.manage",
] as const;

type PayrollTile = {
  key: string;
  href: string;
  icon: typeof Wallet;
  tint: (typeof HUB_GLYPH_TINTS)[keyof typeof HUB_GLYPH_TINTS];
  permission: Permission;
  /** HR Payroll also opens for `payroll.manage`, exactly as it does today. */
  orManage?: boolean;
};

const REPORT_TILES: PayrollTile[] = [
  {
    key: "performance",
    href: "/performance",
    icon: BarChart3,
    tint: HUB_GLYPH_TINTS.teal,
    permission: "performance.view",
  },
  {
    key: "orderReconciliation",
    href: "/deliveries/reconciliation",
    icon: Scale,
    tint: HUB_GLYPH_TINTS.navy,
    permission: "order_recon.view",
  },
];

const PAYROLL_TILES: PayrollTile[] = [
  {
    key: "payroll",
    href: "/payroll",
    icon: Wallet,
    tint: HUB_GLYPH_TINTS.gold,
    permission: "payroll.view",
  },
  {
    key: "hrPayroll",
    href: "/payroll/hr",
    icon: FileSpreadsheet,
    tint: HUB_GLYPH_TINTS.rose,
    permission: "payroll.hr_payroll",
    orManage: true,
  },
];

export default async function PayrollHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAnyPermission(locale, HUB_PERMISSIONS);
  const t = await getTranslations("pages.payrollHub.hub");

  const can = (tile: PayrollTile): boolean =>
    hasPermissionInSet(session.permissions, tile.permission, session.isSuperAdmin) ||
    (tile.orManage === true &&
      hasPermissionInSet(session.permissions, "payroll.manage", session.isSuperAdmin));

  const groups: HubGroup[] = [
    {
      id: "reports",
      heading: t("reportsHeading"),
      hint: t("reportsHint"),
      tiles: REPORT_TILES.filter(can).map((tile) => ({
        href: tile.href,
        label: t(`cards.${tile.key}.title`),
        icon: tile.icon,
        tint: tile.tint,
      })),
    },
    {
      id: "payroll",
      heading: t("payrollHeading"),
      hint: t("payrollHint"),
      tiles: PAYROLL_TILES.filter(can).map((tile) => ({
        href: tile.href,
        label: t(`cards.${tile.key}.title`),
        icon: tile.icon,
        tint: tile.tint,
      })),
    },
  ].filter((group) => group.tiles.length > 0);

  return (
    <AppHubShell
      title={t("title")}
      subtitle={t("subtitle")}
      breadcrumbHome={t("breadcrumbHome")}
      titleTile={{ icon: Wallet, tint: HUB_GLYPH_TINTS.gold }}
      groups={groups}
    />
  );
}
