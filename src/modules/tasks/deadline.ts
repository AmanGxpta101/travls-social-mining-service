import { BadRequestException } from "@nestjs/common";

/**
 * Challenge deadlines are picked as a calendar day and run to the end of that
 * day in India time (Travls' users and ops are there), so "ends 12 Oct" means
 * submissions count until 23:59:59 IST on 12 Oct.
 */
const IST_OFFSET = "+05:30";

/** Today's date in IST, as YYYY-MM-DD. */
export function todayIST(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Parses a YYYY-MM-DD deadline into the last moment of that day (IST). Rejects past days. */
export function parseDeadline(day: string, now = new Date()): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequestException("the deadline must be a date (YYYY-MM-DD)");
  const end = new Date(`${day}T23:59:59.999${IST_OFFSET}`);
  // JS rolls impossible days over (30 Feb -> 2 Mar), so check the day survives the round trip.
  if (Number.isNaN(end.getTime()) || todayIST(end) !== day) {
    throw new BadRequestException("the deadline isn't a real date");
  }
  if (day < todayIST(now)) throw new BadRequestException("the deadline can't be in the past");
  return end;
}

/** True once a challenge's deadline has passed. No deadline never ends. */
export function hasEnded(task: { deadline: Date | null }, now = new Date()): boolean {
  return task.deadline !== null && task.deadline < now;
}
