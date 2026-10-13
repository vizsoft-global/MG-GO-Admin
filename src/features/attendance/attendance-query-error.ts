export function attendanceWindowTooLarge(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  return message.includes("attendance_window_too_large");
}

/** Throw on the client. A server-action throw is redacted on the preview, so the sentence never arrives. */
export function throwIfAttendanceWindow(result: { errorMessage?: string }): void {
  if (result.errorMessage && attendanceWindowTooLarge({ message: result.errorMessage })) {
    throw new Error(result.errorMessage);
  }
}
