"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { Edit3, Loader2, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Locale = {
  code: string;
  name: string;
  native_name: string;
  dir: "ltr" | "rtl";
  enabled: boolean;
  is_default: boolean;
  translation_count?: number;
  needs_review_count?: number;
};

async function fetchLocales(): Promise<Locale[]> {
  const res = await fetch("/api/admin/locales");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed");
  return json.locales || [];
}

export function LanguagesPanel() {
  const t = useTranslations("pages.settings.languages");
  const queryClient = useQueryClient();
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const { data: locales = [], isLoading: loading } = useQuery({
    queryKey: ["admin-locales"],
    queryFn: fetchLocales,
  });

  const updateLocale = async (
    code: string,
    patch: Partial<Pick<Locale, "enabled" | "is_default">>,
  ) => {
    setSavingCode(code);
    try {
      const res = await fetch(`/api/admin/locales/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      await queryClient.invalidateQueries({ queryKey: ["admin-locales"] });
      toast.success(t("updated"));
    } catch (e) {
      toast.error(t("updateFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingCode(null);
    }
  };

  return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardContent className="p-0">
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("colCode")}
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("colLanguage")}
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("colDirection")}
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("colTranslations")}
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("colEnabled")}
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("colDefault")}
                </TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("colActions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locales.map((l) => (
                <TableRow key={l.code} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs uppercase">{l.code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground" dir={l.dir}>
                      {l.native_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {l.dir}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {l.translation_count ?? 0} {t("keys")}
                      </Badge>
                      {(l.needs_review_count ?? 0) > 0 && (
                        <Badge
                          variant="outline"
                          className="border-accent text-[10px] text-accent"
                        >
                          {l.needs_review_count} {t("needReview")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={l.enabled}
                      disabled={savingCode === l.code || l.is_default}
                      onCheckedChange={(v) => updateLocale(l.code, { enabled: v })}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    {l.is_default ? (
                      <Badge className="gap-1">
                        <Star className="h-3 w-3" />
                        {t("default")}
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={savingCode === l.code || !l.enabled}
                        onClick={() => updateLocale(l.code, { is_default: true })}
                        className="h-7 text-xs"
                      >
                        {t("setDefault")}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5"
                      render={
                        <Link href={`/settings/languages/${l.code}`}>
                          <Edit3 className="h-3 w-3" />
                          <span className="text-xs">{t("editTranslations")}</span>
                        </Link>
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
