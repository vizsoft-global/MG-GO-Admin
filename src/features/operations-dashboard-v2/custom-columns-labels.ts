import type { useTranslations } from "next-intl";
import type { RosterBaseField } from "./custom-columns";

type OperationsTranslator = ReturnType<typeof useTranslations<"pages.operationsDashboardV2">>;

/**
 * The app's own heading for a base rider column.
 *
 * Kept as a switch over literals rather than a lookup table because the message
 * catalogue is typed: a record keyed by field would need a cast, and a cast here
 * is exactly what would let a renamed key fail at runtime instead of at build.
 */
export function rosterBaseHeading(field: RosterBaseField, t: OperationsTranslator): string {
  switch (field) {
    case "employeeId":
      return t("colEmployeeId");
    case "name":
      return t("colName");
    case "project":
      return t("colProject");
    case "zone":
      return t("colZone");
    case "status":
      return t("colStatus");
    case "joined":
      return t("colJoined");
    case "nationalityCategory":
      return t("colNationalityCategory");
    case "nationalityCountry":
      return t("colNationalityCountry");
    case "phone":
      return t("colPhone");
  }
}
