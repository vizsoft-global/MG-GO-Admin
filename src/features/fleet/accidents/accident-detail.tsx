"use client";

import { useRouter } from "@/i18n/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { AppFormSection } from "@/components/app/app-form-section";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query/query-keys";
import { formatKwd } from "@/lib/format/money";
import { AccidentAttachments } from "./accident-attachments";
import {
  appendAccidentAttachment,
  removeAccidentAttachment,
  setAccidentCase,
} from "./accident-actions";
import {
  accidentAttachmentKeys,
  accidentCaseStatusOf,
  accidentDayOf,
  accidentDescriptionOf,
} from "./accident-model";
import {
  ACCIDENT_CASE_STATUSES,
  ACCIDENT_CASE_STATUS_TONE,
  type AccidentRow,
} from "./accident-types";
import { accidentErrorKey } from "./use-accidents";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value && value !== "" ? value : "—"}</p>
    </div>
  );
}

export function AccidentDetail({
  accident,
  canManage,
}: {
  accident: AccidentRow;
  canManage: boolean;
}) {
  const t = useTranslations("pages.fleetAccidents");
  const tCase = useTranslations("pages.fleetAccidents.caseStatus");
  const tFault = useTranslations("pages.fleetAccidents.driverFault");
  const tVehicleCase = useTranslations("pages.fleetAccidents.vehicleCaseStatus");
  const tClaim = useTranslations("pages.fleetAccidents.insuranceClaimStatus");
  const tPolice = useTranslations("pages.fleetAccidents.policeReportStatus");
  const tSource = useTranslations("pages.fleetAccidents.source");
  const tSeverity = useTranslations("pages.fleetAccidents.severity");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const status = accidentCaseStatusOf(accident);

  async function changeCase(next: string) {
    setSaving(true);
    const result = await setAccidentCase(accident.id, next);
    setSaving(false);
    if ("error" in result) {
      toast.error(t(accidentErrorKey(result.error)));
      return;
    }
    toast.success(t("caseChanged"));
    void queryClient.invalidateQueries({ queryKey: queryKeys.accidents.all() });
    router.refresh();
  }

  async function remove(key: string) {
    const result = await removeAccidentAttachment(accident.id, key);
    if ("error" in result) {
      toast.error(t(accidentErrorKey(result.error)));
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.accidents.all() });
    router.refresh();
  }

  async function add(key: string) {
    const result = await appendAccidentAttachment(accident.id, key);
    if ("error" in result) {
      toast.error(t(accidentErrorKey(result.error)));
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.accidents.all() });
    router.refresh();
  }

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={accident.reference ?? t("legacyRow")}
        description={[accident.plate_snapshot, accidentDayOf(accident)].filter(Boolean).join(" · ")}
        breadcrumbs={[
          { label: t("title"), href: "/fleet/accident" },
          { label: accident.reference ?? accident.id },
        ]}
        actions={
          <>
            <Badge variant="outline" className={ACCIDENT_CASE_STATUS_TONE[status]}>
              {tCase(status)}
            </Badge>
            {canManage
              ? ACCIDENT_CASE_STATUSES.filter((key) => key !== status).map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    className="h-9"
                    disabled={saving}
                    onClick={() => void changeCase(key)}
                  >
                    {tCase(key)}
                  </Button>
                ))
              : null}
            {canManage ? (
              <Button
                type="button"
                className="h-9"
                onClick={() => router.push(`/fleet/accident/${accident.id}/edit`)}
              >
                <Pencil className="h-4 w-4" />
                {t("actions.edit")}
              </Button>
            ) : null}
          </>
        }
      />

      <AppFormSection title={t("detail.caseTitle")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("cols.vehicle")} value={accident.plate_snapshot} />
          <Field label={t("form.modelYear")} value={accident.model_year?.toString() ?? null} />
          <Field label={t("cols.vehicleCompany")} value={accident.vehicle_company_name} />
          <Field
            label={t("cols.driver")}
            value={[accident.driver_name, accident.employee_id].filter(Boolean).join(" · ")}
          />
          <Field
            label={t("cols.date")}
            value={accident.occurred_at ? accident.occurred_at.slice(0, 16).replace("T", " ") : null}
          />
          <Field label={t("cols.location")} value={accident.location_text} />
          <Field label={t("cols.case")} value={tCase(status)} />
          <Field
            label={t("cols.driverFault")}
            value={accident.driver_fault ? tFault(accident.driver_fault) : null}
          />
          <Field
            label={t("cols.vehicleCase")}
            value={accident.vehicle_case_status ? tVehicleCase(accident.vehicle_case_status) : null}
          />
          <Field label={t("form.replacementPlate")} value={accident.replacement_plate} />
          <Field label={t("cols.source")} value={tSource(accident.source)} />
          <Field
            label={t("form.reportedBy")}
            value={accident.reported_by_name ?? accident.reported_by}
          />
        </div>
      </AppFormSection>

      <AppFormSection title={t("detail.otherPartyTitle")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("cols.otherParty")} value={accident.other_party_name} />
          <Field label={t("form.otherPartyPlate")} value={accident.other_party_plate} />
          <Field label={t("form.otherPartyPhone")} value={accident.other_party_phone} />
          <Field label={t("cols.insuranceCompany")} value={accident.insurance_company} />
          <Field
            label={t("cols.insuranceClaim")}
            value={accident.insurance_claim_status ? tClaim(accident.insurance_claim_status) : null}
          />
          <Field
            label={t("cols.policeReport")}
            value={accident.police_report_status ? tPolice(accident.police_report_status) : null}
          />
          <Field
            label={t("form.amount")}
            value={accident.amount_kwd == null ? null : formatKwd(accident.amount_kwd)}
          />
        </div>
      </AppFormSection>


      <AppFormSection title={t("detail.notesTitle")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.description")} value={accidentDescriptionOf(accident)} />
          <Field label={t("cols.fleetComment")} value={accident.fleet_comment} />
          <Field
            label={t("form.severity")}
            value={accident.severity ? tSeverity(accident.severity as "low") : null}
          />
          <Field label={t("detail.reviewedAt")} value={accident.reviewed_at?.slice(0, 16).replace("T", " ")} />
          <Field label={t("detail.reviewedBy")} value={accident.reviewed_by_name} />
          <Field label={t("detail.reviewNote")} value={accident.review_note} />
        </div>
      </AppFormSection>

      <AppFormSection title={t("form.sectionAttachments")}>
        <AccidentAttachments
          vehicleId={accident.vehicle_id}
          attachments={attachmentsOf(accident)}
          canManage={canManage}
          onAdded={(attachment) => void add(attachment.key)}
          onRemove={(key) => void remove(key)}
        />
      </AppFormSection>
    </AppPage>
  );
}

/**
 * The stored metadata, plus a row for a key that has none (a legacy
 * `storage_key`, or an upload whose ledger row was already swept).
 */
function attachmentsOf(accident: AccidentRow): AccidentRow["attachments"] {
  const keys = accidentAttachmentKeys(accident);
  const known = new Map(accident.attachments.map((meta) => [meta.key, meta]));
  return keys.map(
    (key) =>
      known.get(key) ?? {
        key,
        file_name: null,
        kind: null,
        content_type: null,
        size: null,
        uploaded_by: null,
        at: null,
      },
  );
}

