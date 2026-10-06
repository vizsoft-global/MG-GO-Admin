export function maskedListSender(
  isConfidential: boolean,
  name: string,
  confidentialLabel: string,
): string {
  return isConfidential ? confidentialLabel : name;
}

export function shouldLogConfidentialView(isConfidential: boolean): boolean {
  return isConfidential;
}
