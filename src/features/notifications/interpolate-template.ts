/** Replace `{{ variable }}` placeholders in notification templates. */
export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function extractTemplatePlaceholders(template: string): string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    keys.add(match[1]!);
  }
  return [...keys];
}
