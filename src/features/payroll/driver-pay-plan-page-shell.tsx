"use client";

import { useTranslations } from "next-intl";
import { AppPage, AppPageHeader } from "@/components/app";
import { useAuth } from "@/contexts/auth-context";
import { PayPlanEditor } from "./pay-plan-editor";

export function DriverPayPlanPageShell() {
  const t = useTranslations("pages.payroll.payPlan");
  const { can } = useAuth();

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("hint")} />
      <PayPlanEditor canManage={can("payroll.manage")} />
    </AppPage>
  );
}
