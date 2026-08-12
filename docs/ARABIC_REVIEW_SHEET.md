# Gulf-native Arabic review sheet

**Who this is for:** a native Gulf (ideally Kuwaiti) Arabic speaker familiar with how delivery and HR staff actually talk. Not a general MSA translator — the strings below are already correct MSA. What we need to know is whether a rider in Kuwait would *use* these words.

**How to use it:** fill in the **Verdict** column with `OK` or a replacement. Anything left blank ships as-is.

**Why these and not the whole app:** every other string is ordinary vocabulary. The terms below were either coined for this product, are company-specific, or are process words with several defensible Arabic renderings.

---

## 1. Coined and company-specific terms

| # | English | Current Arabic | Where it appears | Verdict |
|---|---|---|---|---|
| 1 | E-Sign / electronic signature | التوقيع الإلكتروني | Sign inbox, complaint category 7 | |
| 2 | I agree this is my legal electronic signature. | أقر بأن هذا توقيعي الإلكتروني المعتمد قانوناً. | Signature capture — this is the legally operative sentence | |
| 3 | Signature proof | إثبات التوقيع | Signed confirmation screen | |
| 4 | Central Tower | البرج المركزي | Visit branch | |
| 5 | Musallam Central Tower | برج مسلم المركزي | Default visit branch name | |
| 6 | Salary justification | توضيح الراتب | Request type tile + list | |
| 7 | Wrong Action | مخالفة | Compliance module | |
| 8 | Acknowledge | إقرار بالاطلاع | Button on an approved request | |
| 9 | Acknowledge update | الإقرار بالتحديث | Action-required list | |
| 10 | Acknowledged | تم الإقرار | Status chip | |
| 11 | Passcode | رمز الدخول | Login | |
| 12 | Booking token {code} | رمز الحجز {code} | Visit ticket | |
| 13 | Scan at reception | امسح الرمز في الاستقبال | Visit ticket | |
| 14 | From admin | من الإدارة | E-Sign source line | |
| 15 | Screenshots disabled for this document | لقطات الشاشة معطّلة لهذا المستند | Restricted document banner | |

### Specific doubts to settle

- **#7 `مخالفة`** is "violation / infraction", which is heavier than the English "Wrong Action". If the company treats these as coaching notes rather than disciplinary records, this word is too strong.
- **#8 vs #10** use two different roots for the same act (`إقرار بالاطلاع` = acknowledging you have seen it; `تم الإقرار` = it has been acknowledged). Confirm the pairing reads naturally as one flow.
- **#11 `رمز الدخول`** for a 6-digit numeric passcode — check this is not confused with an OTP, which riders also receive.
- **#4 / #5** — confirm the building is actually called this in Arabic locally, rather than being a translation of the English name.

---

## 2. Complaint categories

Seeded 2026-08-12. These are MSA and were never reviewed by a native speaker.

| # | English | Current Arabic | Verdict |
|---|---|---|---|
| 1 | Payments | المدفوعات | |
| 2 | Salary Issues | مشاكل الراتب | |
| 3 | Attendance / Check-in | الحضور / تسجيل الدخول | |
| 4 | Visit / Booking Issues | مشاكل الزيارات / الحجز | |
| 5 | Vehicle / Fuel | المركبة / الوقود | |
| 6 | HR / Workplace | الموارد البشرية / بيئة العمل | |
| 7 | Document / E-Sign Issues | مشاكل المستندات / التوقيع الإلكتروني | |
| 8 | App / Technical Issue | مشكلة في التطبيق / تقنية | |
| 9 | Other | أخرى | |

### Specific doubts to settle

- **#3 `تسجيل الدخول`** is the same phrase the app uses for *signing in*. For duty check-in this is genuinely ambiguous and is the single most likely mistranslation on this page.
- **#8** mixes a noun and an adjective across the slash (`مشكلة في التطبيق / تقنية`), which reads awkwardly. A native rewrite is welcome.
- **#1 vs #2** — riders may not distinguish "Payments" from "Salary Issues". If they would not, say so and we will merge them rather than translate around the problem.

---

## Applying the verdicts

- Items 1–15 live in `lib/l10n/app_ar.arb` in the driver app; changing them needs an app release.
- The nine categories live in the `complaint_categories` table and are editable from the admin panel at `/requests/settings/complaint-categories` — **no app release needed**.
