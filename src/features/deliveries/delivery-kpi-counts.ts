export type ExactCountResult = {
  count: number | null;
  error: { message: string } | null;
};

export function readExactCount(result: ExactCountResult): number {
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}
