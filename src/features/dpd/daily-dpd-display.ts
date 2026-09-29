/** Home Daily DPD card numerator. Payout / lock stay on `completed_today`. */
export function dailyDpdDisplayCount(input: {
  progress_today?: number | null;
  completed_today: number;
}): number {
  return input.progress_today ?? input.completed_today;
}
