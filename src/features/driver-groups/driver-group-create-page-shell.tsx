"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { createDriverGroup } from "./driver-groups-actions";
import {
  DriverGroupFormFields,
  type DriverGroupFormValues,
} from "./driver-group-form-fields";

const INITIAL_VALUES: DriverGroupFormValues = {
  name: "",
  description: "",
  iconKey: "users",
  memberIds: [],
};

export function DriverGroupCreatePageShell() {
  const t = useTranslations("pages.driverGroups");
  const router = useRouter();
  const [values, setValues] = useState<DriverGroupFormValues>(INITIAL_VALUES);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const result = await createDriverGroup({
        name: values.name,
        description: values.description,
        iconKey: values.iconKey,
        memberIds: values.memberIds,
      });
      if ("error" in result) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("created"));
      router.push(`/drivers/groups/${result.id}`);
    });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("createTitle")}
        description={t("formSubtitle")}
        actions={
          <Button
            render={<Link href="/drivers/groups" />}
            variant="outline"
            className="h-9 cursor-pointer"
          >
            <ArrowLeft className="size-4" />
            {t("backToList")}
          </Button>
        }
      />
      <AppListCard>
        <div className="space-y-6 p-4 sm:p-6">
          <DriverGroupFormFields values={values} onChange={setValues} />
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button
              render={<Link href="/drivers/groups" />}
              variant="outline"
              className="h-9 cursor-pointer"
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-9 cursor-pointer"
              disabled={pending || !values.name.trim()}
              onClick={handleSave}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        </div>
      </AppListCard>
    </AppPage>
  );
}
