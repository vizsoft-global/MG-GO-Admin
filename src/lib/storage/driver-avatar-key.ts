export function pickDriverAvatarKey(params: {
  avatarObjectKey?: string | null;
  profileAvatarUrl?: string | null;
  intakeAvatarUrl?: string | null;
}): string | null {
  const keys = [
    params.avatarObjectKey,
    params.profileAvatarUrl,
    params.intakeAvatarUrl,
  ];
  for (const key of keys) {
    const trimmed = key?.trim() ?? "";
    if (trimmed) return trimmed;
  }
  return null;
}

export function isDriverOwnedAvatarKey(
  driverId: string,
  objectKey: string | null | undefined,
): boolean {
  const key = objectKey?.trim() ?? "";
  if (!key || key.includes("..")) return false;
  const adminKey = new RegExp(
    `^drivers/${driverId}/avatar\\.[a-z0-9]+$`,
    "i",
  );
  return (
    key.startsWith(`driver-avatars/${driverId}/`) || adminKey.test(key)
  );
}
