/**
 * Builds MG_Flow_Contract_Coverage_Tracker.xlsx (contract vs build tracker).
 * Output: %USERPROFILE%\Downloads\MG_Flow_Contract_Coverage_Tracker.xlsx
 */
import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";

const OUT_NAME =
  process.env.COVERAGE_XLSX_NAME || "MG_Flow_Contract_Coverage_Tracker.xlsx";
const OUT = path.join(os.homedir(), "Downloads", OUT_NAME);

const HEADERS = [
  "Module name",
  "Task list",
  "Priority",
  "Design",
  "Dev team",
  "Estimation",
  "Contract status",
  "Build status",
  "Notes",
];

const HEADER_FILLS = [
  "BDD7EE", // Module — light blue
  "C6EFCE", // Task — light green
  "FFE699", // Priority — yellow
  "E2D5F1", // Design — lavender
  "F8CBAD", // Dev team — peach
  "BDD7EE", // Estimation — light blue
  "D9E2F3", // Contract status
  "FFF2CC", // Build status
  "F2F2F2", // Notes
];

const PRIORITIES = ["High", "Medium", "Low"];
const DESIGNS = ["Done", "In progress", "Not started", "N/A"];
const DEV_TEAMS = ["Admin", "User App", "Both", "Backend"];
const CONTRACT_STATUSES = ["In contract", "Beyond contract", "Partial"];
const BUILD_STATUSES = ["Done", "Partial", "Not developed", "Coming soon"];

/** @type {Array<[string, string, string, string, string, string, string, string, string]>} */
const CONTRACT_ROWS = [
  [
    "1. Centralized Database",
    "Single centralized DB for manpower & ops data; scalable foundation",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "Supabase Postgres; Admin + Driver App share production project",
  ],
  [
    "1. Centralized Database",
    "Bulk import/export, filtering, grouping, sorting (zone, nationality, project, role)",
    "High",
    "Done",
    "Admin",
    "Done",
    "In contract",
    "Partial",
    "Drivers bulk import/export + filters; some advanced multi-field report queries still limited",
  ],
  [
    "1. Centralized Database",
    "Role-based access; admins manage, users see relevant data only",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "Admin RBAC permissions; riders blocked from admin panel",
  ],
  [
    "1. Centralized Database",
    "Status colors + Archive for leavers (keep data in system)",
    "High",
    "Done",
    "Admin",
    "Done",
    "In contract",
    "Done",
    "Driver status pills + soft-archive on intakes/drivers",
  ],
  [
    "1. Centralized Database",
    'Instant filter/report e.g. "Drivers in Jahra with 2+ years experience"',
    "Medium",
    "Not started",
    "Admin",
    "3–5d",
    "In contract",
    "Partial",
    "List filters exist; natural-language style compound experience reports not built",
  ],
  [
    "2. Geo-Fence Attendance",
    "GPS geo-fence check-in/out; working hours after successful check-in",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "driver_set_duty_state + attendance_logs; Admin Live/Logs",
  ],
  [
    "2. Geo-Fence Attendance",
    "Track movement, inactivity, zone-exit violations without orders",
    "High",
    "In progress",
    "Both",
    "5–8d",
    "In contract",
    "Partial",
    "Out-of-zone tracking + wrong-actions exist; full stop-time / violation report pack incomplete",
  ],
  [
    "2. Geo-Fence Attendance",
    "45-min no activity after exit → finalize checkout + hours",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "attendance_auto_checkout_minutes default 45 + cron RPC",
  ],
  [
    "2. Geo-Fence Attendance",
    "Reports: working hours, stop times, zone violations",
    "Medium",
    "In progress",
    "Admin",
    "3–5d",
    "In contract",
    "Partial",
    "Working hours columns on attendance; stop-time analytics still thin",
  ],
  [
    "3. Incentive & Performance",
    "DPD targets, daily deliveries, wallet earnings, auto incentive over target",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "incentive_rules, delivery_rules, driver_earnings_daily, wallet ledger",
  ],
  [
    "3. Incentive & Performance",
    "Admin bulk upload DPD; adjust rules; performance reports + date filter",
    "High",
    "Done",
    "Admin",
    "3–5d",
    "In contract",
    "Partial",
    "Rules pages + earnings calc/export done; dedicated bulk DPD import still recommended in SOP",
  ],
  [
    "3. Incentive & Performance",
    "Manual order entry with invoice → DPD check → wallet credit",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "Driver delivery logging + admin verify → recalc earnings",
  ],
  [
    "3. Incentive & Performance",
    "Rider personal dashboard: profile, DPD, daily perf, wallet, date range",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "Driver app home/earnings; Admin /performance + /earnings",
  ],
  [
    "3. Incentive & Performance",
    "Move Incentive/Delivery Rules off Settings to separate pages",
    "Low",
    "Done",
    "Admin",
    "Done",
    "In contract",
    "Done",
    "SOP minor improvement — /delivery-rules + /incentive-rules pages",
  ],
  [
    "4. Admin Task, Notifications & Communication",
    "Task management (ops tasks / hygiene-style tasks between riders & management)",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Partial",
    "Hygiene tasks + submissions exist; general admin task board beyond hygiene is limited",
  ],
  [
    "4. Admin Task, Notifications & Communication",
    "Announcements (bulk and zone-based)",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "Campaign targeting includes zone/bulk; announcement category in payload",
  ],
  [
    "4. Admin Task, Notifications & Communication",
    "Single/bulk notifications; different subjects/texts; targeted send + track responses",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "Notification Center v2 campaigns + FCM + in-app inbox",
  ],
  [
    "4. Admin Task, Notifications & Communication",
    "Notification history searchable by employee code; receipt/read status",
    "High",
    "Done",
    "Admin",
    "Done",
    "In contract",
    "Done",
    "Campaign detail attempts + history routes",
  ],
  [
    "4. Admin Task, Notifications & Communication",
    "Screenshots of notifications not allowed; show receipt/read status to admins",
    "Medium",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "screenshot_restricted stamp + native enforcement",
  ],
  [
    "5. Requests & Complaints",
    "Complaints request (subject + message)",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "request_type = complaint",
  ],
  [
    "5. Requests & Complaints",
    "Loan requests + loan terms",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "request_type = loan",
  ],
  [
    "5. Requests & Complaints",
    "Fuel reimbursement request",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "request_type = fuel + fuel-receipts storage",
  ],
  [
    "5. Requests & Complaints",
    "Leave requests (list/history of requested)",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "request_type = leave",
  ],
  [
    "5. Requests & Complaints",
    "Document handling request",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Partial",
    "request_type = document; full lifecycle polish varies",
  ],
  [
    "5. Requests & Complaints",
    "Salary Justification request",
    "High",
    "Not started",
    "Both",
    "3–5d",
    "In contract",
    "Not developed",
    "Not in request_type enum today",
  ],
  [
    "5. Requests & Complaints",
    "Appointment request with calendar booking",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "Support → Appointments (slots + bookings)",
  ],
  [
    "5. Requests & Complaints",
    "Asset Request (browse assets + reason)",
    "High",
    "Not started",
    "Both",
    "4–6d",
    "In contract",
    "Not developed",
    "Admin asset inventory exists; rider Asset Request flow not a request_type",
  ],
  [
    "5. Requests & Complaints",
    "Any new / generic request type (extensible)",
    "Medium",
    "Not started",
    "Both",
    "3–5d",
    "In contract",
    "Not developed",
    "Fixed enum: loan|leave|fuel|complaint|document",
  ],
  [
    "5. Requests & Complaints",
    "Subject + message notes; pending → approved/solved by admin per type",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Partial",
    "Status workflows exist; approve vs solve matrix not identical for every type",
  ],
  [
    "5. Requests & Complaints",
    "Reports: counts, time-to-resolve, group by status/employee/zone; bulk + export",
    "Medium",
    "Not started",
    "Admin",
    "5–7d",
    "In contract",
    "Not developed",
    "SOP Coming Soon note for full Requests maturity",
  ],
  [
    "6. AI Chatbot & Smart Analytics",
    "Natural-language queries, report generation, insights (EN + AR)",
    "Medium",
    "Not started",
    "Both",
    "20–30d",
    "In contract",
    "Not developed",
    "SOP: Not Available",
  ],
  [
    "7. Analytics, Reporting & Forecasting",
    "Advanced reporting; demand patterns, rider shortages, cost trends",
    "Medium",
    "In progress",
    "Admin",
    "10–15d",
    "In contract",
    "Partial",
    "Ops KPIs, delivery orders report, performance; predictive forecasting not built",
  ],
  [
    "8. System Language",
    "Arabic + English system support",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Done",
    "next-intl admin + driver locale; locales admin settings",
  ],
  [
    "8. System Language",
    "Arabic switch lag / missing data polish",
    "Medium",
    "In progress",
    "Both",
    "2–3d",
    "In contract",
    "Partial",
    "SOP note: lag and some data not displayed correctly in AR",
  ],
  [
    "9. Training Page",
    "Track sessions, participation, evaluation status",
    "Medium",
    "Not started",
    "Both",
    "8–12d",
    "In contract",
    "Not developed",
    "SOP: Training Page is missing",
  ],
  [
    "10. Performance Management",
    "Monthly performance reports / summaries per employee",
    "High",
    "Done",
    "Admin",
    "Done",
    "In contract",
    "Done",
    "/performance weighted score + attendance/deliveries/compliance",
  ],
  [
    "11. Live Dashboard",
    "Active workforce by status; exclude statuses; live geo-fence activity",
    "High",
    "Done",
    "Admin",
    "Done",
    "In contract",
    "Done",
    "Live tracking + Performance Live tab; on-duty realtime",
  ],
  [
    "11. Live Dashboard",
    "Order counts by date/time; highest/lowest zone; individual & group effectiveness",
    "High",
    "Done",
    "Admin",
    "3–5d",
    "In contract",
    "Partial",
    "Deliveries reports + zone views; some effectiveness grouping still polish",
  ],
  [
    "11. Live Dashboard",
    "Filtering and sorting across live views",
    "High",
    "Done",
    "Admin",
    "Done",
    "In contract",
    "Done",
    "Filters on live/history tracking and lists",
  ],
  [
    "12. Penalty Management",
    "Penalty types dropdown; notify individual/bulk; rider can respond",
    "High",
    "Not started",
    "Both",
    "10–14d",
    "In contract",
    "Coming soon",
    "Wrong-actions ≠ full penalty module; e-sign/print not implemented",
  ],
  [
    "12. Penalty Management",
    "Report/print: employee code, name, notice date, details; e-signature",
    "Medium",
    "Not started",
    "Admin",
    "4–6d",
    "In contract",
    "Not developed",
    "SOP: e-signature and print not implemented",
  ],
  [
    "13. Secure Login & Compliance",
    "Mandatory live photo at every login (helmet, box, uniform)",
    "High",
    "Not started",
    "User App",
    "8–12d",
    "In contract",
    "Not developed",
    "SOP: only first-launch permissions today",
  ],
  [
    "13. Secure Login & Compliance",
    "Dress-code image verification; violation log + auto penalty",
    "High",
    "Not started",
    "Both",
    "8–12d",
    "In contract",
    "Not developed",
    "Depends on vision/ML or manual review workflow",
  ],
  [
    "13. Secure Login & Compliance",
    "GPS always on; turning GPS off logs rider out immediately",
    "High",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Not developed",
    "SOP gap vs continuous GPS enforcement",
  ],
  [
    "14. Weekly Schedule & Manual Shift",
    "Weekly schedule from restaurant/store; rider updates manually",
    "High",
    "Not started",
    "Both",
    "6–8d",
    "In contract",
    "Not developed",
    "SOP: weekly schedule management not available",
  ],
  [
    "14. Weekly Schedule & Manual Shift",
    "Manual shift start with GPS validation + manager visibility/audit",
    "High",
    "Done",
    "Both",
    "Done",
    "In contract",
    "Partial",
    "Current-day shift / duty start exists; weekly + missing-schedule alerts incomplete",
  ],
  [
    "14. Weekly Schedule & Manual Shift",
    "Manager alerts for missing schedule updates",
    "Medium",
    "Not started",
    "Both",
    "2–4d",
    "In contract",
    "Not developed",
    "Depends on weekly schedule module",
  ],
];

/** @type {Array<[string, string, string, string, string, string, string, string, string]>} */
const ENHANCEMENT_ROWS = [
  [
    "Drivers / Auth",
    "Admin-first Verify & approve + 6-digit app passcode login",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "Replaces OTP-first bootstrap for new drivers",
  ],
  [
    "Drivers / Auth",
    "Driver block/unblock with reason; forced off-duty + login hard-block",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "set_driver_blocked RPC + realtime UI",
  ],
  [
    "Drivers",
    "Custom dynamic fields (Settings → Driver Fields) + list column prefs",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Checkbox multi-select, letters-only, number ≥0 validation",
  ],
  [
    "Drivers",
    "Nationality + rider category (in_house / outsourced)",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Copied on approve; list/detail columns",
  ],
  [
    "Drivers",
    "Employee ID mandatory unique 1–8 digits; 5-digit driver codes; soft archive",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "Sequence + archive RPCs",
  ],
  [
    "Drivers",
    "Driver groups module (/drivers/groups)",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Grouping for ops / targeting",
  ],
  [
    "Partners",
    "Partners directory (Talabat / DoorDash / UberEats style partners)",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "/partners + logo on R2",
  ],
  [
    "Restaurants",
    "Restaurants directory; optional partner; publish gate for driver activation",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "driver_has_active_restaurant gate",
  ],
  [
    "Zones",
    "Zones map CRUD (polygon/circle GeoJSON) + multi-vertex draw UX",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Provisional Save + 50+ vertices while drawing",
  ],
  [
    "Restaurants / Zones",
    "Restaurant inclusion/exclusion delivery geofences",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Proximity RPCs for driver app",
  ],
  [
    "Assets",
    "Asset catalog + quantity inventory (/assets) synced to driver form",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Replaces hardcoded asset toggles",
  ],
  [
    "Documents",
    "Document expiry tracking + lead-day notifications (/document-expiry)",
    "Medium",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "Per-doc expiry + compliance page",
  ],
  [
    "Live tracking",
    "Live tracking map + history playback (/live-tracking)",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Realtime driver locations; TrackingMapStage shell",
  ],
  [
    "Deliveries",
    "Live Deliveries queue + verify flow",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "/deliveries Control Tower",
  ],
  [
    "Deliveries",
    "DPD Verification dedicated queue (/dpd-verification)",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Verification-focused ops screen",
  ],
  [
    "Deliveries",
    "Delivery Orders Report matrix export (.xlsx) with shift attribution",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "report_delivery_orders RPC",
  ],
  [
    "Deliveries",
    "Stale pickup auto-cancel (in_transit block recovery)",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "Cron + app_settings.pickup_auto_cancel_hours",
  ],
  [
    "Vehicles",
    "Vehicles module list/detail + assignment to drivers",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "/vehicles",
  ],
  [
    "Attendance",
    "Attendance hub: Today / History / Problems / Analytics tabs",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Beyond basic check-in logs",
  ],
  [
    "Attendance",
    "Auto checkout cron + check_out_reason + working-hours columns + thresholds settings",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "/settings/attendance",
  ],
  [
    "Hygiene / Tasks",
    "Hygiene tasks + photo submissions (admin assign / rider submit)",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "Maps to SOP §4 task management partially",
  ],
  [
    "Wrong Actions",
    "Wrong Actions compliance log module (/wrong-actions)",
    "Medium",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "Related to but not full Penalty Management",
  ],
  [
    "Earnings / Payouts",
    "Earnings transparency + range recalc + wallet ledger",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "/earnings + /earnings-calculation",
  ],
  [
    "Earnings / Payouts",
    "Payout runs: generate / approve / mark paid / void (/payouts)",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "payout_runs + driver_payouts",
  ],
  [
    "Notifications",
    "Templates, automations, analytics, priority approval (send/approve/export)",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Notification Center v2 full suite",
  ],
  [
    "Notifications",
    "Screenshot Force-OFF temporary allow; no-token ≠ wholesale campaign fail",
    "Medium",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "UX/reliability enhancements",
  ],
  [
    "Support",
    "Support chat threads + SOS + appointment slots/booking",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "/support",
  ],
  [
    "Admin platform",
    "Dashboard overview + action queue widgets",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "/dashboard",
  ],
  [
    "Admin platform",
    "Roles & Permissions matrix + Access Requests + super-admin claim",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "RBAC tables",
  ],
  [
    "Admin platform",
    "Branding (logo/name/font) + Driver App settings (splash, maintenance message)",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "/settings/branding + /settings/app",
  ],
  [
    "Admin platform",
    "Maintenance mode (admin) + driver-app maintenance mode (independent)",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "proxy gate + app_settings",
  ],
  [
    "Admin platform",
    "Menu editor (per-role sidebar) + Languages translation admin",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "DB-driven menu_configs + locales",
  ],
  [
    "Admin platform",
    "Audit activity logs (/settings/logs) view + export",
    "Medium",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "admin_activity_logs",
  ],
  [
    "Admin platform",
    "Data cleanup tools + Cloudflare R2 storage settings",
    "Low",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Super-admin only",
  ],
  [
    "Storage / Infra",
    "Cloudflare R2 private docs; Firebase FCM; Play-only release (no sideload OTA)",
    "High",
    "Done",
    "Both",
    "Done",
    "Beyond contract",
    "Done",
    "Production hardening; Developer Options hard-block on driver app",
  ],
  [
    "Performance",
    "Weighted performance score + Live workforce tab",
    "High",
    "Done",
    "Admin",
    "Done",
    "Beyond contract",
    "Done",
    "Extends SOP §10/§11 with configurable weights",
  ],
  [
    "Driver App UX",
    "Active Delivery footer safe-area (system nav) for Cancel / Delivered",
    "Medium",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "Edge-to-edge Android inset fix",
  ],
];

/** @type {Array<[string, string, string, string, string, string, string, string, string]>} */
const GAP_ROWS = [
  [
    "5. Requests & Complaints",
    "Salary Justification request type + admin workflow",
    "High",
    "Not started",
    "Both",
    "3–5d",
    "In contract",
    "Not developed",
    "Missing from request_type enum",
  ],
  [
    "5. Requests & Complaints",
    "Asset Request (rider picks asset + reason) end-to-end",
    "High",
    "Not started",
    "Both",
    "4–6d",
    "In contract",
    "Not developed",
    "Catalog exists; request flow does not",
  ],
  [
    "5. Requests & Complaints",
    "Generic / 'any new' extensible request type",
    "Medium",
    "Not started",
    "Both",
    "3–5d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "5. Requests & Complaints",
    "Resolve-time / SLA reports + bulk ops + export pack",
    "High",
    "Not started",
    "Admin",
    "5–7d",
    "In contract",
    "Not developed",
    "SOP Coming Soon for full maturity",
  ],
  [
    "4. Admin Task",
    "General admin task board beyond hygiene tasks",
    "Medium",
    "Not started",
    "Admin",
    "5–8d",
    "In contract",
    "Partial",
    "Hygiene covers part of SOP 'task management'",
  ],
  [
    "6. AI Chatbot",
    "NL analytics chatbot (EN + AR) with report generation",
    "Medium",
    "Not started",
    "Both",
    "20–30d",
    "In contract",
    "Not developed",
    "Largest open scope item",
  ],
  [
    "7. Analytics",
    "Predictive forecasting (demand, shortage, cost trends)",
    "Medium",
    "Not started",
    "Admin",
    "10–15d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "9. Training Page",
    "Training sessions, participation, evaluation status",
    "Medium",
    "Not started",
    "Both",
    "8–12d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "12. Penalty Management",
    "Full penalty module: types, notify, rider response",
    "High",
    "Not started",
    "Both",
    "10–14d",
    "In contract",
    "Coming soon",
    "Wrong Actions is not a substitute",
  ],
  [
    "12. Penalty Management",
    "Print / e-signature on penalty notices",
    "Medium",
    "Not started",
    "Admin",
    "4–6d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "13. Compliance Login",
    "Live photo every login (helmet / box / uniform)",
    "High",
    "Not started",
    "User App",
    "8–12d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "13. Compliance Login",
    "Dress-code verification + violation + auto penalty",
    "High",
    "Not started",
    "Both",
    "8–12d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "13. Compliance Login",
    "GPS-off immediate logout enforcement",
    "High",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "14. Weekly Schedule",
    "Weekly schedule management + rider update flow",
    "High",
    "Not started",
    "Both",
    "6–8d",
    "In contract",
    "Not developed",
    "Only current-day shift today",
  ],
  [
    "14. Weekly Schedule",
    "Manager alerts for missing schedule updates",
    "Medium",
    "Not started",
    "Both",
    "2–4d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "3. Incentive",
    "Bulk import button for DPD / Incentive Rules mass updates",
    "Medium",
    "Not started",
    "Admin",
    "3–5d",
    "In contract",
    "Not developed",
    "SOP Suggestion",
  ],
  [
    "2. Attendance",
    "Stop-time + zone-violation detailed reporting pack",
    "Medium",
    "Not started",
    "Admin",
    "5–8d",
    "In contract",
    "Partial",
    "",
  ],
  [
    "8. Languages",
    "Arabic UX lag / missing data display polish",
    "Medium",
    "In progress",
    "Both",
    "2–3d",
    "In contract",
    "Partial",
    "SOP improvement note",
  ],
  [
    "1. Database / Reports",
    "Compound experience/zone search report (Jahra + tenure example)",
    "Low",
    "Not started",
    "Admin",
    "3–5d",
    "In contract",
    "Partial",
    "",
  ],
  [
    "11. Live Dashboard",
    "Highest/lowest zone effectiveness + bulk group effectiveness widgets polish",
    "Medium",
    "In progress",
    "Admin",
    "3–5d",
    "In contract",
    "Partial",
    "Live map exists; some SOP KPI wording still thin",
  ],
];

/**
 * User / Driver App (Flutter MG-GO) — client-facing screen inventory.
 * Status grounded in lib/features + app_router.dart (not only handoff wishlist).
 */
/** @type {Array<[string, string, string, string, string, string, string, string, string]>} */
const USER_APP_ROWS = [
  [
    "Auth",
    "Login — driver code + 6-digit app passcode",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §13 login (passcode path); /login",
  ],
  [
    "Auth",
    "Legacy first-link OTP verification (bootstrap only)",
    "Medium",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "/login-verification — older intakes only",
  ],
  [
    "Auth / Compliance",
    "Mandatory live dress-code photo at every login (helmet, box, uniform) + auto penalty",
    "High",
    "Not started",
    "User App",
    "12–18d",
    "In contract",
    "Not developed",
    "SOP §13 — not in Flutter today",
  ],
  [
    "Auth / Compliance",
    "GPS always-on; GPS-off forces immediate logout",
    "High",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Not developed",
    "SOP §13 — first-launch permissions only",
  ],
  [
    "Auth / Ops",
    "Blocked screen when admin blocks driver (reason shown)",
    "High",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "/blocked",
  ],
  [
    "Auth / Ops",
    "Driver-app maintenance mode screen",
    "Medium",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "/maintenance — admin Settings → Driver App",
  ],
  [
    "Security",
    "Developer Options / sideload hard-block (Play-only)",
    "High",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "developer_mode_blocked_screen",
  ],
  [
    "Security",
    "Notification screenshot restriction (FLAG_SECURE + allow session)",
    "Medium",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §4 screenshot not allowed",
  ],
  [
    "Home",
    "Home — duty/online toggle, weekly KPIs, bumper / incentive cards",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §3 individual dashboard; /home",
  ],
  [
    "Home",
    "SOS emergency button",
    "High",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Coming soon",
    "UI chip shows 'SOS coming soon' — not wired",
  ],
  [
    "Attendance / Geo",
    "Geo-fence duty check-in/out + working hours (attendance screen)",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §2; /profile/attendance + Home duty",
  ],
  [
    "Attendance / Geo",
    "Outside-zone warning / timer + 45-min auto checkout sync",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Partial",
    "Server auto-checkout + client sync; full stop-time UX thin",
  ],
  [
    "Attendance / Schedule",
    "Weekly schedule update + manual shift start with GPS",
    "High",
    "Not started",
    "User App",
    "8–12d",
    "In contract",
    "Not developed",
    "SOP §14 — current-day duty only",
  ],
  [
    "Deliveries",
    "Deliveries list (calendar / history)",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "/deliveries",
  ],
  [
    "Deliveries",
    "Add delivery / pickup (order ID + proof) → Active → Finish → Success",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §3 manual order entry; pending sync queue",
  ],
  [
    "Deliveries",
    "Pending deliveries offline/queue screen",
    "Medium",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "/deliveries/pending",
  ],
  [
    "Earnings",
    "Earnings — period view, day detail, wallet / incentives",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §3; /earnings + day detail",
  ],
  [
    "Earnings",
    "Extra earnings / incentive quest + payout detail",
    "Medium",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "/earnings/extra, /earnings/payout/:id",
  ],
  [
    "Notifications",
    "Notifications inbox (FCM + in-app); open restricted detail",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §4; /notifications",
  ],
  [
    "Hygiene / Tasks",
    "Hygiene task photo submit from notification/task flow",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Partial",
    "Via notifications/hygiene submissions — not a full task board",
  ],
  [
    "Requests",
    "Fuel reimbursement request + history",
    "High",
    "Not started",
    "User App",
    "4–6d",
    "In contract",
    "Not developed",
    "Admin/backend ready; no Flutter request screens in router",
  ],
  [
    "Requests",
    "Loan request list + new loan",
    "High",
    "Not started",
    "User App",
    "4–6d",
    "In contract",
    "Not developed",
    "l10n mentions loans as coming-soon breakdown only",
  ],
  [
    "Requests",
    "Leave request + history",
    "High",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Not developed",
    "Profile label 'Attendance & Leaves' → attendance screen only today",
  ],
  [
    "Requests",
    "Complaint submit",
    "High",
    "Not started",
    "User App",
    "2–4d",
    "In contract",
    "Not developed",
    "No dedicated screen in app_router",
  ],
  [
    "Requests",
    "Document handling request",
    "Medium",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Not developed",
    "",
  ],
  [
    "Requests",
    "Salary Justification request",
    "High",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Not developed",
    "Missing backend enum + app UI",
  ],
  [
    "Requests",
    "Asset Request (browse assets + reason)",
    "High",
    "Not started",
    "User App",
    "4–6d",
    "In contract",
    "Not developed",
    "Admin catalog exists",
  ],
  [
    "Support",
    "Control Tower chat",
    "High",
    "Not started",
    "User App",
    "6–10d",
    "In contract",
    "Not developed",
    "Admin /support exists; rider chat UI not in router",
  ],
  [
    "Support",
    "Appointment calendar booking",
    "High",
    "Not started",
    "User App",
    "4–6d",
    "In contract",
    "Not developed",
    "Admin appointments; no rider booking screen",
  ],
  [
    "Compliance",
    "Wrong Action details + history (rider view)",
    "Medium",
    "Not started",
    "User App",
    "3–5d",
    "In contract",
    "Coming soon",
    "Profile/menu label exists; full history UI incomplete",
  ],
  [
    "Penalty",
    "View penalty notices + rider response",
    "High",
    "Not started",
    "User App",
    "5–8d",
    "In contract",
    "Coming soon",
    "SOP §12",
  ],
  [
    "Vehicle",
    "Vehicle info screen",
    "Medium",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "/vehicle tab",
  ],
  [
    "Profile",
    "Profile — identity, documents view, locale EN/AR",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Done",
    "SOP §3 / §8; /profile",
  ],
  [
    "Languages",
    "Arabic + English in driver app",
    "High",
    "Done",
    "User App",
    "Done",
    "In contract",
    "Partial",
    "SOP §8 — AR polish still needed in places",
  ],
  [
    "Training",
    "Training page — sessions, participation, evaluation",
    "Medium",
    "Not started",
    "User App",
    "8–12d",
    "In contract",
    "Not developed",
    "SOP §9",
  ],
  [
    "AI Chatbot",
    "In-app NL analytics chatbot (EN + AR)",
    "Medium",
    "Not started",
    "User App",
    "20–30d",
    "In contract",
    "Not developed",
    "SOP §6",
  ],
  [
    "UX polish",
    "Active Delivery footer safe-area (system navigation)",
    "Medium",
    "Done",
    "User App",
    "Done",
    "Beyond contract",
    "Done",
    "Cancel / Mark Delivered not covered by nav bar",
  ],
];

/** Full admin nav inventory — catches modules missed from narrative sheets */
/** @type {Array<[string, string, string, string, string, string, string, string, string]>} */
const MODULE_INVENTORY_ROWS = [
  ["Dashboard", "/dashboard — overview KPIs & action queue", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Drivers", "/drivers — CRUD, approve, archive, passcode, block", "High", "Done", "Both", "Done", "In contract", "Done", "§1 workforce master data"],
  ["Driver groups", "/drivers/groups", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Live tracking", "/live-tracking — live + history", "High", "Done", "Admin", "Done", "In contract", "Done", "§2 / §11 geo workforce"],
  ["Partners", "/partners", "High", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Restaurants", "/restaurants + geofence editor", "High", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Zones", "/zones map CRUD", "High", "Done", "Admin", "Done", "In contract", "Done", "§2 geo-fence foundation"],
  ["Assets", "/assets inventory", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", "Supports §5 asset request later"],
  ["Live Deliveries", "/deliveries", "High", "Done", "Both", "Done", "In contract", "Done", "§3 order entry / verify"],
  ["DPD Verification", "/dpd-verification", "High", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Vehicles", "/vehicles", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Attendance", "/attendance (+ settings thresholds)", "High", "Done", "Both", "Done", "In contract", "Done", "§2"],
  ["Performance", "/performance", "High", "Done", "Admin", "Done", "In contract", "Done", "§10 / §11"],
  ["Document expiry", "/document-expiry", "Medium", "Done", "Both", "Done", "Beyond contract", "Done", "Related §5 documents"],
  ["Requests", "/requests (loan/leave/fuel/complaint/document)", "High", "Done", "Both", "Done", "In contract", "Partial", "§5 Coming Soon maturity"],
  ["Wrong Actions", "/wrong-actions", "Medium", "Done", "Both", "Done", "Beyond contract", "Done", "Not full §12 Penalty"],
  ["Earnings", "/earnings", "High", "Done", "Both", "Done", "In contract", "Done", "§3"],
  ["Delivery rules", "/delivery-rules", "High", "Done", "Admin", "Done", "In contract", "Done", "SOP separate-page note done"],
  ["Incentive rules", "/incentive-rules", "High", "Done", "Admin", "Done", "In contract", "Done", "SOP separate-page note done"],
  ["Earnings calculation", "/earnings-calculation", "High", "Done", "Admin", "Done", "In contract", "Done", "§3"],
  ["Payouts", "/payouts", "High", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Notifications", "/notifications (+ templates/automations/analytics)", "High", "Done", "Both", "Done", "In contract", "Done", "§4"],
  ["Hygiene tasks", "Hygiene task assign + submissions (via notifications/ops)", "High", "Done", "Both", "Done", "In contract", "Partial", "§4 task management"],
  ["Support", "/support chat, SOS, appointments", "High", "Done", "Both", "Done", "In contract", "Done", "§5 appointments"],
  ["Settings / Branding", "/settings/branding", "Low", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Driver App", "/settings/app maintenance & branding", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Driver Fields", "/settings/driver-fields", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Roles", "/settings/roles", "High", "Done", "Admin", "Done", "In contract", "Done", "§1 RBAC"],
  ["Settings / Access requests", "/settings/access-requests", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Maintenance", "/settings/maintenance", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Menu editor", "/settings/menu-editor", "Low", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Languages", "/settings/languages", "High", "Done", "Admin", "Done", "In contract", "Done", "§8"],
  ["Settings / Logs", "/settings/logs audit", "Medium", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Storage", "/settings/storage R2", "Low", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["Settings / Data cleanup", "/settings/data-cleanup", "Low", "Done", "Admin", "Done", "Beyond contract", "Done", ""],
  ["AI Chatbot", "Natural language analytics", "Medium", "Not started", "Both", "20–30d", "In contract", "Not developed", "§6"],
  ["Training", "Training page", "Medium", "Not started", "Both", "8–12d", "In contract", "Not developed", "§9"],
  ["Penalty Management", "Dedicated penalties module", "High", "Not started", "Both", "10–14d", "In contract", "Coming soon", "§12"],
  ["Compliance login photos", "Dress-code photo gate every login", "High", "Not started", "User App", "12–18d", "In contract", "Not developed", "§13"],
  ["Weekly schedule", "Weekly schedule + alerts", "High", "Not started", "Both", "8–12d", "In contract", "Not developed", "§14"],
];

function styleHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell, colNumber) => {
    cell.font = { bold: true, size: 11, color: { argb: "FF1F2937" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    const fill = HEADER_FILLS[colNumber - 1] ?? "D9E2F3";
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${fill}` },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FF94A3B8" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });
}

function styleBodyRow(row) {
  row.eachCell((cell) => {
    cell.font = { size: 10, color: { argb: "FF111827" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
  });
  // Soft alternating feel via Priority/Build columns later via CF if needed
}

function setColumnWidths(ws) {
  const widths = [28, 52, 12, 14, 12, 12, 16, 14, 40];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

function addDropdowns(ws, rowCount) {
  if (rowCount < 1) return;
  const end = rowCount + 1; // header is row 1
  const lists = {
    3: `"${PRIORITIES.join(",")}"`,
    4: `"${DESIGNS.join(",")}"`,
    5: `"${DEV_TEAMS.join(",")}"`,
    7: `"${CONTRACT_STATUSES.join(",")}"`,
    8: `"${BUILD_STATUSES.join(",")}"`,
  };
  for (const [col, formulae] of Object.entries(lists)) {
    ws.dataValidations.add(`${colLetter(+col)}2:${colLetter(+col)}${end}`, {
      type: "list",
      allowBlank: true,
      formulae: [formulae],
      showErrorMessage: true,
      errorTitle: "Invalid value",
      error: "Pick a value from the dropdown list.",
    });
  }
}

function colLetter(n) {
  return String.fromCharCode(64 + n);
}

function addDataSheet(wb, name, title, rows) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 2, showGridLines: false }],
  });

  ws.mergeCells("A1:I1");
  const titleCell = ws.getCell("A1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 28;

  const headerRow = ws.addRow(HEADERS);
  styleHeaderRow(headerRow);

  for (const r of rows) {
    const row = ws.addRow(r);
    styleBodyRow(row);
    row.height = 36;
    // Soft fill on Build status
    const build = r[7];
    const buildCell = row.getCell(8);
    const map = {
      Done: "FFC6EFCE",
      Partial: "FFFFF2CC",
      "Not developed": "FFF8CBAD",
      "Coming soon": "FFFFE699",
    };
    if (map[build]) {
      buildCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: map[build] },
      };
    }
  }

  setColumnWidths(ws);
  addDropdowns(ws, rows.length);
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: rows.length + 2, column: HEADERS.length },
  };
  return ws;
}

function addClientBriefSheet(wb) {
  const ws = wb.addWorksheet("Client brief", {
    views: [{ showGridLines: false }],
  });

  ws.mergeCells("A1:B1");
  ws.getCell("A1").value =
    "MG Flow — Client Delivery Status Brief (Admin Panel + User App)";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  ws.getRow(1).height = 28;

  const lines = [
    ["Document purpose", "Show what the MG Flow SOP contract covers, what is live in Admin + Rider User App, what was added beyond contract, and what remains with estimation."],
    ["Products", "1) Admin Control Tower (web) — https://dpdadmin-prod.vercel.app  2) Rider User App (Flutter / Google Play)"],
    ["Contract source", "MG Flow SOP.docx.pdf — modules §1–14"],
    ["Admin — largely delivered", "Central DB/RBAC, Drivers (approve/passcode/archive), Zones & restaurant geofences, Attendance + 45-min auto-checkout, Live tracking, Deliveries + DPD verification, Delivery/Incentive rules + Earnings + Payouts, Notifications Center (bulk/zone, read status, screenshot restrict), Performance + Live workforce, Support (admin side), Document expiry, Assets inventory, Partners/Restaurants, EN/AR admin i18n."],
    ["User App — delivered (core ops)", "Passcode login, Home duty + KPIs/incentives, Geo attendance, Full delivery flow (add/active/finish/pending), Earnings + payout detail, Notifications inbox + screenshot lock, Vehicle, Profile, Maintenance/Blocked/Developer-block, EN/AR."],
    ["User App — contract gaps (important for client)", "SOP Requests suite not in Flutter router yet (Fuel/Loan/Leave/Complaint/Document/Salary/Asset). Chat, SOS (Coming soon chip), Appointments booking, Weekly schedule, Login dress-code photos + GPS-off logout, Training page, AI chatbot, Penalty respond — Not developed / Coming soon. See sheet «User App»."],
    ["Beyond contract (value-add)", "Admin-first provisioning, custom driver fields, R2 private storage, payout runs, notification automations/templates, performance weighted score, stale-pickup auto-cancel, document expiry, menu editor, audit logs, Play-only release hardening, Active Delivery safe-area fix, etc. See sheet «Enhancements»."],
    ["How to read this workbook", "Green Done = live. Yellow Partial/Coming soon = started or UI placeholder. Orange Not developed = backlog. Estimation column = indicative man-days for open items."],
    ["Recommended client ask", "Prioritize User App Requests + SOS/Support chat + Weekly schedule + Compliance login photos; keep AI chatbot / Training as Phase-2."],
  ];

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 96;
  ws.addRow(["Topic", "Summary"]);
  styleHeaderRow(ws.getRow(2));
  lines.forEach((pair) => {
    const row = ws.addRow(pair);
    styleBodyRow(row);
    row.height = 48;
    row.getCell(1).font = { bold: true, size: 10 };
  });
  return ws;
}

function addSummarySheet(wb) {
  const ws = wb.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
  });

  ws.mergeCells("A1:F1");
  ws.getCell("A1").value =
    "MG Flow — Contract Coverage Tracker (Admin Panel + User App)";
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 32;

  ws.mergeCells("A2:F2");
  ws.getCell("A2").value =
    "Source: MG Flow SOP (client contract) · Products: Admin Control Tower + Driver User App · Generated for delivery status review";
  ws.getCell("A2").font = { size: 10, italic: true, color: { argb: "FF475569" } };
  ws.getRow(2).height = 20;

  // KPI cards
  const userDone = USER_APP_ROWS.filter((r) => r[7] === "Done").length;
  const userOpen = USER_APP_ROWS.filter(
    (r) => r[7] === "Not developed" || r[7] === "Coming soon" || r[7] === "Partial",
  ).length;
  const kpis = [
    ["Contract tasks (sheet)", CONTRACT_ROWS.length],
    ["Enhancements beyond contract", ENHANCEMENT_ROWS.length],
    ["Open gaps (backlog rows)", GAP_ROWS.length],
    ["Admin module inventory rows", MODULE_INVENTORY_ROWS.length],
    ["User App screen rows", USER_APP_ROWS.length],
    ["User App Done", userDone],
    ["User App Partial / Coming soon / Not developed", userOpen],
    [
      "Contract Done",
      CONTRACT_ROWS.filter((r) => r[7] === "Done").length,
    ],
    [
      "Contract Partial",
      CONTRACT_ROWS.filter((r) => r[7] === "Partial").length,
    ],
    [
      "Contract Not developed / Coming soon",
      CONTRACT_ROWS.filter(
        (r) => r[7] === "Not developed" || r[7] === "Coming soon",
      ).length,
    ],
  ];

  ws.getRow(4).values = ["KPI", "Count"];
  styleHeaderRow(ws.getRow(4));
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 14;
  kpis.forEach((k, i) => {
    const row = ws.addRow(k);
    styleBodyRow(row);
    row.height = 20;
  });

  // Legend
  ws.getCell("D4").value = "Build status legend";
  ws.getCell("D4").font = { bold: true, size: 11 };
  const legend = [
    ["Done", "FFC6EFCE"],
    ["Partial", "FFFFF2CC"],
    ["Coming soon", "FFFFE699"],
    ["Not developed", "FFF8CBAD"],
  ];
  legend.forEach(([label, color], i) => {
    const cell = ws.getCell(`D${5 + i}`);
    cell.value = label;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: color },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
  });

  ws.getColumn(4).width = 18;

  ws.getCell("A12").value = "How to use";
  ws.getCell("A12").font = { bold: true, size: 12 };
  ws.getCell("A13").value =
    "1) Contract coverage — SOP §1–14. 2) Enhancements — beyond contract. 3) Gaps backlog — open work + estimation. 4) Module inventory — Admin nav. 5) User App — Flutter rider app screens (client-critical). 6) Client brief — executive summary for stakeholder review.";
  ws.mergeCells("A13:F15");
  ws.getCell("A13").alignment = { wrapText: true, vertical: "top" };

  ws.getCell("A17").value = "Dropdown values";
  ws.getCell("A17").font = { bold: true, size: 11 };
  ws.getCell("A18").value = `Priority: ${PRIORITIES.join(" | ")}`;
  ws.getCell("A19").value = `Design: ${DESIGNS.join(" | ")}`;
  ws.getCell("A20").value = `Dev team: ${DEV_TEAMS.join(" | ")}`;
  ws.getCell("A21").value = `Contract status: ${CONTRACT_STATUSES.join(" | ")}`;
  ws.getCell("A22").value = `Build status: ${BUILD_STATUSES.join(" | ")}`;

  // Rough open effort from Gaps (mid of ranges as helper note)
  ws.getCell("A24").value = "Open backlog estimation (indicative midpoints)";
  ws.getCell("A24").font = { bold: true, size: 11 };
  ws.getCell("A25").value =
    "Sum of midpoint estimates on Gaps backlog ≈ 110–130 man-days (depends on AI chatbot + compliance + penalties scope). Refine Estimation column per your rates.";
  ws.mergeCells("A25:F26");
  ws.getCell("A25").alignment = { wrapText: true };

  return ws;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MGgo Admin / Vizsoft";
  wb.created = new Date();

  addSummarySheet(wb);
  addClientBriefSheet(wb);
  addDataSheet(
    wb,
    "Contract coverage",
    "Contract coverage — MG Flow SOP §1–14 vs Admin + User App",
    CONTRACT_ROWS,
  );
  addDataSheet(
    wb,
    "User App",
    "User App (Flutter rider) — screens vs contract; status from MG-GO router + features",
    USER_APP_ROWS,
  );
  addDataSheet(
    wb,
    "Enhancements",
    "Enhancements — developed beyond / in addition to contract wording",
    ENHANCEMENT_ROWS,
  );
  addDataSheet(
    wb,
    "Gaps backlog",
    "Gaps backlog — not developed / partial with estimation (screenshot-style tracker)",
    GAP_ROWS,
  );
  addDataSheet(
    wb,
    "Module inventory",
    "Module inventory — Admin menu + contract gaps checklist (missed-list catcher)",
    MODULE_INVENTORY_ROWS,
  );

  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
