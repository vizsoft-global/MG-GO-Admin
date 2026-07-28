#!/usr/bin/env node
/**
 * Usage: npm run new:page -- <slug> <permission>
 * Example: npm run new:page -- analytics reports.view
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const [slug, permission = `${slug}.view`] = process.argv.slice(2);

if (!slug) {
  console.error("Usage: npm run new:page -- <slug> [permission]");
  process.exit(1);
}

const pageName = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const labelKey = `nav.${slug.replace(/-/g, "")}`;
const pageDir = join(root, "src/app/[locale]/(dashboard)", slug);
const pageFile = join(pageDir, "page.tsx");

if (existsSync(pageFile)) {
  console.error(`Page already exists: ${pageFile}`);
  process.exit(1);
}

mkdirSync(pageDir, { recursive: true });

writeFileSync(
  pageFile,
  `import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function ${pageName.replace(/\s/g, "")}Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "${permission}");
  const t = await getTranslations("pages.${slug.replace(/-/g, "")}");

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{t("placeholder")}</p>
        </CardContent>
      </Card>
    </>
  );
}
`,
);

function patchMessages(filePath, localeTitle) {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  data.nav = data.nav ?? {};
  data.nav[slug.replace(/-/g, "")] = localeTitle;
  data.pages = data.pages ?? {};
  data.pages[slug.replace(/-/g, "")] = {
    title: localeTitle,
    subtitle: localeTitle,
    placeholder: "Coming soon",
  };
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

patchMessages(join(root, "src/messages/en.json"), pageName);
patchMessages(join(root, "src/messages/ar.json"), pageName);

console.log(`
Created: ${pageFile}

Next steps:
1. Add to src/config/navigation.ts:
   { href: "/${slug}", labelKey: "${labelKey}", icon: "LayoutDashboard", permission: "${permission}" }
2. Add PERMISSIONS entry in src/lib/auth/permissions.ts if new permission
3. Update ROLE_PERMISSIONS for staff role
4. Follow docs/DESIGN_SYSTEM.md and src/components/app/*
5. If driver-facing: update docs/DRIVER_APP_HANDOFF.md [admin+app]
`);
