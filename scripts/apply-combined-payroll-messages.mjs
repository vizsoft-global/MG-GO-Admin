/**
 * One-shot catalogue patch for the Combined Payroll SOP (items 1–14).
 *
 *   node scripts/apply-combined-payroll-messages.mjs
 *
 * Idempotent: it sets values rather than appending, so a second run is a no-op.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MESSAGES = join(process.cwd(), "src", "messages");

const TEXT = {
  en: {
    kpi: {
      riders: "Riders in payroll",
      active: "Total active riders",
      avgEfficiency: "Avg attendance eff.",
      activeAmericana: "Total active AM",
      activeKeeta: "Total active Keeta",
    },
    columns: {
      columns: "Columns",
      count: "{visible}/{total}",
      title: "Show and reorder columns",
      hint: "Your order and your hidden columns are saved for you.",
      pinned: "MG ID · Driver ID · Name stay pinned and cannot be moved.",
      drag: "Drag to reorder",
      show: "Show column",
      hide: "Hide column",
      reset: "Reset order",
      renameHint: "Double-click a heading to rename it.",
    },
    cols: {
      days: "Days",
      restaurant: "Restaurant",
      zone: "Zone",
      zoneCategory: "Zone Category",
      projectName: "Project Name",
      vehicle: "Vehicle",
      status: "Status",
      workingDays: "Working Days",
      totalHours: "Total Hours",
      totalOrders: "Total Orders",
      requiredHours: "Required Hours",
      actualHours: "Actual Hours",
      efficiency: "Efficiency %",
      threeHourDays: "3 Hours Days",
      sixHourDays: "6 Hours Days",
      actualDays: "Actual Days",
      off: "OFF",
      sick: "Sick",
      accident: "Accident",
      adjusted: "Adjusted",
      unexcused: "Unexcused Absence",
      lessHours: "Less Hours",
      lessOrders: "Less Orders",
    },
    cellEdit: {
      changed: "{name} · {field} changed to {value}",
      restaurantField: "Restaurant",
      zoneField: "Zone",
      clientField: "Project Name",
      restaurantPlaceholder: "Restaurant",
      restaurantSearch: "Search restaurants",
    },
    slicer: {
      partner: "Project Name",
      allPartners: "All projects",
      nounPartners: "Projects",
      searchPartner: "Search project",
      zoneCategory: "Zone Category",
      allZoneCategories: "All zone categories",
    },
    columnFilter: { sortPair: "Sort {column}" },
    legend: { work: "Active", reduced3: "3 Hours", half: "6 Hours" },
    riderCols: {
      totalDays: "Working Days",
      finalOrders: "Total Orders",
      partner: "Project Name",
      reduced3: "3 Hours Days",
      half: "6 Hours Days",
      absLh: "Less Hours",
      absLo: "Less Orders",
      absence: "Unexcused Absence",
      efficiency: "Efficiency %",
    },
    dayStatus: { work: "Active · 12 h", reduced3: "3 Hours", half: "6 Hours" },
    banner:
      "One table: MG ID · Driver ID · Name are pinned, the day block follows Status, and every column after it is yours to order. Required Hours = counted days × the project's day length (Americana 12 h, Keeta 10 h).",
  },
};

const AR = {
  kpi: {
    riders: "الراكبون في الرواتب",
    active: "إجمالي الراكبين النشطين",
    avgEfficiency: "متوسط كفاءة الحضور",
    activeAmericana: "إجمالي النشطين أمريكانا",
    activeKeeta: "إجمالي النشطين كيتا",
  },
  columns: {
    columns: "الأعمدة",
    count: "{visible}/{total}",
    title: "إظهار الأعمدة وترتيبها",
    hint: "يُحفظ ترتيبك والأعمدة المخفية لك.",
    pinned: "MG ID · Driver ID · الاسم مثبّتة ولا يمكن نقلها.",
    drag: "اسحب لإعادة الترتيب",
    show: "إظهار العمود",
    hide: "إخفاء العمود",
    reset: "إعادة الترتيب",
    renameHint: "انقر نقرًا مزدوجًا على العنوان لإعادة تسميته.",
  },
  cols: {
    days: "الأيام",
    restaurant: "المطعم",
    zone: "المنطقة",
    zoneCategory: "فئة المنطقة",
    projectName: "اسم المشروع",
    vehicle: "المركبة",
    status: "الحالة",
    workingDays: "أيام العمل",
    totalHours: "إجمالي الساعات",
    totalOrders: "إجمالي الطلبات",
    requiredHours: "الساعات المطلوبة",
    actualHours: "الساعات الفعلية",
    efficiency: "الكفاءة ٪",
    threeHourDays: "أيام 3 ساعات",
    sixHourDays: "أيام 6 ساعات",
    actualDays: "الأيام الفعلية",
    off: "راحة",
    sick: "مرض",
    accident: "حادث",
    adjusted: "معدَّل",
    unexcused: "غياب بدون عذر",
    lessHours: "ساعات أقل",
    lessOrders: "طلبات أقل",
  },
  cellEdit: {
    changed: "{name} · تم تغيير {field} إلى {value}",
    restaurantField: "المطعم",
    zoneField: "المنطقة",
    clientField: "اسم المشروع",
    restaurantPlaceholder: "المطعم",
    restaurantSearch: "بحث في المطاعم",
  },
  slicer: {
    partner: "اسم المشروع",
    allPartners: "كل المشاريع",
    nounPartners: "مشاريع",
    searchPartner: "بحث في المشاريع",
    zoneCategory: "فئة المنطقة",
    allZoneCategories: "كل فئات المناطق",
  },
  columnFilter: { sortPair: "ترتيب {column}" },
  legend: { work: "نشط", reduced3: "3 ساعات", half: "6 ساعات" },
  riderCols: {
    totalDays: "أيام العمل",
    finalOrders: "إجمالي الطلبات",
    partner: "اسم المشروع",
    reduced3: "أيام 3 ساعات",
    half: "أيام 6 ساعات",
    absLh: "ساعات أقل",
    absLo: "طلبات أقل",
    absence: "غياب بدون عذر",
    efficiency: "الكفاءة ٪",
  },
  dayStatus: { work: "نشط · 12 ساعة", reduced3: "3 ساعات", half: "6 ساعات" },
  banner:
    "جدول واحد: MG ID · Driver ID · الاسم مثبّتة، وكتلة الأيام بعد الحالة، وترتيب بقية الأعمدة لك. الساعات المطلوبة = الأيام المحتسبة × طول يوم المشروع (أمريكانا 12 ساعة، كيتا 10 ساعات).",
};

TEXT.ar = AR;

for (const locale of ["en", "ar"]) {
  const file = join(MESSAGES, `${locale}.json`);
  const catalogue = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const payroll = catalogue.pages.payroll;
  const text = TEXT[locale];

  payroll.combinedKpi = { ...(payroll.combinedKpi ?? {}), ...text.kpi };
  payroll.combinedColumns = { ...(payroll.combinedColumns ?? {}), ...text.columns };
  payroll.combinedCols = { ...(payroll.combinedCols ?? {}), ...text.cols };
  payroll.cellEdit = { ...(payroll.cellEdit ?? {}), ...text.cellEdit };
  payroll.slicer = { ...(payroll.slicer ?? {}), ...text.slicer };
  payroll.columnFilter = { ...(payroll.columnFilter ?? {}), ...text.columnFilter };
  payroll.legend = { ...payroll.legend, ...text.legend };
  payroll.riderCols = { ...payroll.riderCols, ...text.riderCols };
  payroll.dayStatus = { ...payroll.dayStatus, ...text.dayStatus };
  payroll.combinedBannerBody = text.banner;

  writeFileSync(file, `${JSON.stringify(catalogue, null, 2)}\n`, "utf8");
  console.log(`${locale}: patched`);
}

