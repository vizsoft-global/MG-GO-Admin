import type { AssistantRefuseCode } from "./assistant-refuse";

const REFUSE_EN: Record<AssistantRefuseCode, string> = {
  report_delivery_orders:
    "I cannot generate the shift-day Orders Report. Open /deliveries and use Generate.",
  freeform_sql: "I cannot run SQL or invent a query. Ask about authorized dashboard data.",
  write_shaped:
    "I cannot change data. Verify or reject on /deliveries; payouts on /earnings Tools; rules on /incentive-rules or /delivery-rules.",
  unknown_tool: "That is outside what Staff Assistant can do.",
};

const REFUSE_AR: Record<AssistantRefuseCode, string> = {
  report_delivery_orders:
    "لا يمكنني إنشاء تقرير الطلبات حسب الوردية. افتح /deliveries واستخدم Generate.",
  freeform_sql: "لا يمكنني تشغيل SQL أو اختراع استعلام. اسأل عن بيانات لوحة التحكم المصرّح بها.",
  write_shaped:
    "لا يمكنني تغيير البيانات. التحقق/الرفض من /deliveries؛ الدفعات من /earnings؛ القواعد من /incentive-rules أو /delivery-rules.",
  unknown_tool: "هذا خارج صلاحيات مساعد الموظفين.",
};

export const ASSISTANT_REFUSE_COPY = REFUSE_EN;

export function refuseCopy(code: string, locale: "en" | "ar" = "en"): string {
  const table = locale === "ar" ? REFUSE_AR : REFUSE_EN;
  if (code in table) return table[code as AssistantRefuseCode];
  if (code === "not_authorized") {
    return locale === "ar"
      ? "ليست لديك صلاحية لهذا التقرير."
      : "You do not have permission for that report.";
  }
  if (code === "gateway_not_configured") {
    return locale === "ar"
      ? "المساعد غير متصل. اطلب من المسؤول إكمال إعداد AI Gateway."
      : "The assistant is not connected. Ask an administrator to finish AI Gateway setup.";
  }
  if (code === "range_too_large") {
    return locale === "ar"
      ? "نطاق التاريخ أطول من 400 يوم."
      : "That date range is longer than 400 days.";
  }
  if (code === "ambiguous") {
    return locale === "ar"
      ? "وجد أكثر من سجل. حدّد الرمز أو المعرّف."
      : "Several records matched. Specify the code or id.";
  }
  return table.unknown_tool;
}

export function lastUserText(
  messages: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    return (message.parts ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}
