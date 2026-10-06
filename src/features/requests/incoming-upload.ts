export function incomingUploadReady(input: {
  driverId: string;
  subject: string;
  fileCount: number;
}): boolean {
  return Boolean(input.driverId && input.subject.trim() && input.fileCount > 0);
}

export function incomingUploadStartsRoute(startRoute: boolean): boolean {
  return startRoute;
}
