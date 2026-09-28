import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDpdNoticeMessage, type DpdNoticeCandidate } from "./dpd-shift-notice-messages";

const base: DpdNoticeCandidate = {
  driver_id: "d1",
  shift_date: "2026-09-25",
  kind: "warning",
  target: 10,
  completed: 7,
  incentive_kwd: 0,
  minutes_left: 30,
  locale: "en",
};

test("warning names the time left and the orders still needed", () => {
  const m = buildDpdNoticeMessage(base);
  assert.equal(m.title, "Today's target not reached yet");
  assert.equal(
    m.body,
    "Your shift ends in 30 minutes and you're at 7 of 10 deliveries. Complete 3 more to hit today's DPD target and unlock your incentives.",
  );
});

test("congrats matches the SOP copy", () => {
  const m = buildDpdNoticeMessage({ ...base, kind: "congrats", completed: 10, minutes_left: null });
  assert.equal(m.title, "Congratulations — target achieved!");
  assert.equal(
    m.body,
    "You completed 10 of 10 deliveries today. Every extra order from now on earns a bonus.",
  );
});

test("summary prints the incentive with three decimals", () => {
  const m = buildDpdNoticeMessage({ ...base, kind: "summary", completed: 13, incentive_kwd: "0.750" });
  assert.equal(m.title, "Great shift — you earned a bonus");
  assert.equal(
    m.body,
    "You finished on 13 deliveries and earned 0.750 KD in incentives today. Keep it up tomorrow!",
  );
});

test("Arabic locale gets Arabic copy", () => {
  const m = buildDpdNoticeMessage({ ...base, locale: "ar" });
  assert.equal(m.title, "لم يتحقق هدف اليوم بعد");
  assert.match(m.body, /7 من 10/);
});
