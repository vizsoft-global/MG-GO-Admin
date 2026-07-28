"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Above dialogs (1101) and popovers (1200). */
const UPDATE_OVERLAY_Z = "z-[1300]";

export function UpdateRequiredDialog({
  clientBuildId,
  serverBuildId,
}: {
  clientBuildId?: string;
  serverBuildId?: string;
}) {
  const t = useTranslations("system.update");

  return (
    <div
      className={`fixed inset-0 ${UPDATE_OVERLAY_Z} flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
    >
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle id="update-required-title">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("body")}</p>
          {process.env.NODE_ENV === "development" &&
          clientBuildId &&
          serverBuildId ? (
            <p className="font-mono text-[10px] text-muted-foreground/80">
              client: {clientBuildId.slice(0, 12)}… → server:{" "}
              {serverBuildId.slice(0, 12)}…
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full cursor-pointer rounded-lg"
            onClick={() => window.location.reload()}
          >
            {t("refresh")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
