import { redirect } from "@/i18n/navigation";

/** Legacy /dpd tabbed page → delivery rules. */
export default async function DpdRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/delivery-rules", locale });
}
