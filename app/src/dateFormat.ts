import { strings } from './strings';

const timeZone = 'America/New_York';
function format(value: string | Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, ...options }).format(new Date(value));
}
export function formatDate(value: string): string {
  return format(`${value}T12:00:00Z`, { year: 'numeric', month: '2-digit', day: '2-digit' });
}
/** `YYYY-MM-DD HH:mm` (AGENTS.md 4). Built from parts: some ICU versions render en-CA with a comma. */
export function formatDateTime(value: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${String(parts['year'])}-${String(parts['month'])}-${String(parts['day'])} ${String(parts['hour'])}:${String(parts['minute'])}`;
}
export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return strings.relativeLessThanMinute;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return strings.relativeMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? strings.relativeHours(hours) : strings.relativeDays(Math.floor(hours / 24));
}
