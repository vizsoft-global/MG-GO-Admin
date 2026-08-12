/**
 * Mutates ONLY pages.visitBookings in src/messages/{en,ar}.json.
 * Re-reads each file at write time so parallel edits to other namespaces survive.
 */
const fs = require("fs");

const PATCH = {
  en: {
    hub: {
      subtitle: "Pick a module to manage visit bookings, slots, and settings",
      allVisits: "All visits",
      calendar: "Calendar",
      reception: "Reception check-in",
      slots: "Slot & availability",
      departments: "Departments & desks",
      branches: "Branches",
      reports: "Reports",
    },
    calendar: {
      title: "Calendar",
      day: "Day",
      week: "Week",
      today: "Today",
      previous: "Previous",
      next: "Next",
      full: "Full",
      blocked: "Blocked",
      deskCount: "Desk {count}",
      lunchBreak: "Lunch break · {from} – {to}",
      noSlotsTitle: "No booking hours configured",
      noSlotsDescription:
        "Set working days, opening hours and slot length in Slot & availability.",
    },
    slots: {
      title: "Slot & availability",
      subtitle: "Configure booking hours, slot length and capacity for each branch",
      saveChanges: "Save changes",
      workingDaysTitle: "Working days & hours",
      openingTime: "Opening time",
      closingTime: "Closing time",
      lunchBreak: "Lunch break",
      capacityTitle: "Slots & capacity",
      slotLength: "Slot length",
      capacityPerSlot: "Capacity per slot",
      bufferBetween: "Buffer between slots",
      bookingWindow: "Booking window",
      minutesValue: "{minutes} minutes",
      ridersValue: "{count} riders",
      daysAheadValue: "{days} days ahead",
      desksPerDepartment: "Desks per department",
      blockedDatesTitle: "Blocked dates",
      blockedDatesEmpty: "No blocked dates for this branch.",
      addBlockedDate: "Add blocked date",
      removeBlockedDate: "Remove blocked date",
      blockedDate: "Date",
      blockedReason: "Reason",
      blockedReasonPlaceholder: "National day, maintenance…",
      blockedModalSubtitle: "Visits cannot be booked on this date",
      blockedDateRequired: "Pick a date to block",
      hoursRequired: "Set opening and closing time",
      noBranchesDescription:
        "Add a branch in Branches before configuring booking hours.",
    },
  },
  ar: {
    hub: {
      subtitle: "اختر وحدة لإدارة حجوزات الزيارة والمواعيد والإعدادات",
      allVisits: "جميع الزيارات",
      calendar: "التقويم",
      reception: "تسجيل الوصول",
      slots: "المواعيد والإتاحة",
      departments: "الأقسام والمكاتب",
      branches: "الفروع",
      reports: "التقارير",
    },
    calendar: {
      title: "التقويم",
      day: "يوم",
      week: "أسبوع",
      today: "اليوم",
      previous: "السابق",
      next: "التالي",
      full: "مكتمل",
      blocked: "محجوب",
      deskCount: "مكتب {count}",
      lunchBreak: "استراحة الغداء · {from} – {to}",
      noSlotsTitle: "لم يتم ضبط ساعات الحجز",
      noSlotsDescription:
        "اضبط أيام العمل وساعات الفتح ومدة الموعد من المواعيد والإتاحة.",
    },
    slots: {
      title: "المواعيد والإتاحة",
      subtitle: "اضبط ساعات الحجز ومدة الموعد والسعة لكل فرع",
      saveChanges: "حفظ التغييرات",
      workingDaysTitle: "أيام وساعات العمل",
      openingTime: "وقت الفتح",
      closingTime: "وقت الإغلاق",
      lunchBreak: "استراحة الغداء",
      capacityTitle: "المواعيد والسعة",
      slotLength: "مدة الموعد",
      capacityPerSlot: "السعة لكل موعد",
      bufferBetween: "الفاصل بين المواعيد",
      bookingWindow: "نافذة الحجز",
      minutesValue: "{minutes} دقيقة",
      ridersValue: "{count} مندوبين",
      daysAheadValue: "{days} يوماً مقدماً",
      desksPerDepartment: "المكاتب لكل قسم",
      blockedDatesTitle: "التواريخ المحجوبة",
      blockedDatesEmpty: "لا توجد تواريخ محجوبة لهذا الفرع.",
      addBlockedDate: "إضافة تاريخ محجوب",
      removeBlockedDate: "إزالة التاريخ المحجوب",
      blockedDate: "التاريخ",
      blockedReason: "السبب",
      blockedReasonPlaceholder: "عيد وطني، صيانة…",
      blockedModalSubtitle: "لا يمكن حجز زيارات في هذا التاريخ",
      blockedDateRequired: "اختر تاريخاً للحجب",
      hoursRequired: "اضبط وقت الفتح والإغلاق",
      noBranchesDescription: "أضف فرعاً من صفحة الفروع قبل ضبط ساعات الحجز.",
    },
  },
};

for (const locale of ["en", "ar"]) {
  const file = `src/messages/${locale}.json`;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const ns = json.pages.visitBookings;
  const patch = PATCH[locale];

  for (const [group, values] of Object.entries(patch)) {
    ns[group] = { ...(ns[group] ?? {}), ...values };
  }

  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  console.log(locale, "pages.visitBookings updated");
}
