import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { WrongActionDetailPageShell } from "@/features/wrong-actions/wrong-action-detail-page-shell";
import {
  getWrongAction,
  listWrongActionDriverOptions,
} from "@/features/wrong-actions/wrong-actions-actions";

export default async function WrongActionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requirePermission(locale, "wrong_actions.view");

  const [incident, drivers] = await Promise.all([
    getWrongAction(id),
    listWrongActionDriverOptions(),
  ]);
  if (!incident) notFound();

  return (
    <WrongActionDetailPageShell
      incident={incident}
      drivers={drivers}
      editOpen={query.edit === "1"}
    />
  );
}
