export type PartnerFilterRow = { id: string; name: string };

export function buildPartnerFilterOptions(
  partners: PartnerFilterRow[],
  allLabel: string,
): Array<{ id: string; label: string }> {
  return [{ id: "all", label: allLabel }, ...partners.map((p) => ({ id: p.id, label: p.name }))];
}
