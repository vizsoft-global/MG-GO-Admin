export const LOAN_TENURE_MIN = 1;
export const LOAN_TENURE_MAX = 24;

export function loanTenureChoices(): { months: number; label: string }[] {
  const rows: { months: number; label: string }[] = [];
  for (let months = LOAN_TENURE_MIN; months <= LOAN_TENURE_MAX; months += 1) {
    rows.push({
      months,
      label: months === 1 ? "1 month" : `${months} months`,
    });
  }
  return rows;
}

export function isLoanTenureMonth(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const months = Number(value);
  return Number.isInteger(months) && months >= LOAN_TENURE_MIN && months <= LOAN_TENURE_MAX;
}
