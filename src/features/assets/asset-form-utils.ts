export function parseCatalogItemIds(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll("catalogItemIds")
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  ];
}
