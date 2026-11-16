export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Short relative time for lists ("5 min ago"); empty when the timestamp is missing or invalid. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(time).toLocaleDateString();
}
