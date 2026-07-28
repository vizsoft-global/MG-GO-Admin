"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function TranslationEditorPanel({ localeCode }: { localeCode: string }) {
  const t = useTranslations("pages.settings.translationEditor");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string> | null>(null);

  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: ["admin-translations", localeCode],
    queryFn: async () => {
      const res = await fetch(`/api/admin/translations/${localeCode}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      return {
        source: (json.source || {}) as Record<string, string>,
        target: (json.target || {}) as Record<string, string>,
      };
    },
  });

  const source = data?.source ?? {};
  const drafts = edits ?? data?.target ?? {};
  const dirty = edits !== null;

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(source).filter(([key, val]) => {
      if (!q) return true;
      return (
        key.toLowerCase().includes(q) ||
        val.toLowerCase().includes(q) ||
        (drafts[key] ?? "").toLowerCase().includes(q)
      );
    });
  }, [source, drafts, search]);

  const needsReviewCount = useMemo(() => {
    let n = 0;
    for (const key of Object.keys(source)) {
      if (!drafts[key]?.trim()) n++;
    }
    return n;
  }, [source, drafts]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const flat: Record<string, string> = {};
      for (const key of Object.keys(source)) {
        flat[key] = drafts[key] ?? "";
      }
      const res = await fetch(`/api/admin/translations/${localeCode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flat }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setEdits(null);
      await refetch();
      toast.success(t("saved"));
    } catch (e) {
      toast.error(t("saveFailed"), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (localeCode === "en") {
    return (
      <p className="text-sm text-muted-foreground">{t("englishReadOnly")}</p>
    );
  }

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        render={
          <Link href="/settings/languages">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="ps-9"
          />
        </div>
        {needsReviewCount > 0 && (
          <Badge variant="outline" className="border-accent text-accent">
            {needsReviewCount} {t("needReview")}
          </Badge>
        )}
        <Button type="button" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="me-2 h-4 w-4" />
          )}
          {t("save")}
        </Button>
      </div>

      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredKeys.map(([key, enValue]) => {
                const missing = !drafts[key]?.trim();
                return (
                  <div key={key} className="grid gap-2 p-4 md:grid-cols-2">
                    <div>
                      <p className="font-mono text-[11px] text-muted-foreground">{key}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{enValue}</p>
                    </div>
                    <Input
                      value={drafts[key] ?? ""}
                      onChange={(e) => {
                        setEdits((prev) => ({
                          ...(prev ?? data?.target ?? {}),
                          [key]: e.target.value,
                        }));
                      }}
                      className={missing ? "border-accent/50" : undefined}
                      dir={localeCode === "ar" ? "rtl" : "ltr"}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
