export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return addSeconds(date, minutes * 60);
}

export function isExpired(expiresAt: Date | string | null, now = new Date()): boolean {
  if (!expiresAt) {
    return false;
  }
  const at = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return at.getTime() <= now.getTime();
}

export function secondsBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 1000;
}
