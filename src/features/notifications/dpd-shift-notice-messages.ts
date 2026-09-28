export type DpdNoticeKind = "warning" | "congrats" | "summary";

export type DpdNoticeCandidate = {
  driver_id: string;
  shift_date: string;
  kind: DpdNoticeKind;
  target: number;
  completed: number;
  incentive_kwd: number | string | null;
  minutes_left: number | null;
  locale: string | null;
};

export type DpdNoticeMessage = { title: string; body: string };

function kwd(value: number): string {
  return value.toFixed(3);
}

/** Rider-facing copy from the Rider Daily DPD Target SOP (§5). */
export function buildDpdNoticeMessage(c: DpdNoticeCandidate): DpdNoticeMessage {
  const arabic = (c.locale ?? "").toLowerCase().startsWith("ar");
  const remaining = Math.max(0, c.target - c.completed);
  const minutes = Math.max(1, c.minutes_left ?? 30);
  const incentive = kwd(Number(c.incentive_kwd ?? 0));

  switch (c.kind) {
    case "warning":
      return arabic
        ? {
            title: "لم يتحقق هدف اليوم بعد",
            body: `تنتهي نوبتك خلال ${minutes} دقيقة وأنت عند ${c.completed} من ${c.target} توصيلات. أكمل ${remaining} أخرى لتحقيق هدف DPD اليوم وفتح الحوافز.`,
          }
        : {
            title: "Today's target not reached yet",
            body: `Your shift ends in ${minutes} minutes and you're at ${c.completed} of ${c.target} deliveries. Complete ${remaining} more to hit today's DPD target and unlock your incentives.`,
          };
    case "congrats":
      return arabic
        ? {
            title: "تهانينا — تم تحقيق الهدف!",
            body: `أكملت ${c.completed} من ${c.target} توصيلات اليوم. كل طلب إضافي من الآن يمنحك مكافأة.`,
          }
        : {
            title: "Congratulations — target achieved!",
            body: `You completed ${c.completed} of ${c.target} deliveries today. Every extra order from now on earns a bonus.`,
          };
    case "summary":
      return arabic
        ? {
            title: "نوبة رائعة — حصلت على مكافأة",
            body: `أنهيت نوبتك بـ ${c.completed} توصيلة وحصلت على ${incentive} د.ك حوافز اليوم. واصل التميز غداً!`,
          }
        : {
            title: "Great shift — you earned a bonus",
            body: `You finished on ${c.completed} deliveries and earned ${incentive} KD in incentives today. Keep it up tomorrow!`,
          };
  }
}
