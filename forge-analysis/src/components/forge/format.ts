// Small formatting helpers used throughout the Forge UI.

/**
 * Format a byte count into a human-readable string (e.g. "1.2 KB", "3.4 MB").
 */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const v = n / Math.pow(1024, i);
  const rounded = i === 0 ? v : Math.round(v * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/**
 * Format a duration (ms) into a short readable form (e.g. "189 ms", "12.3 s", "1 m 4 s").
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  if (m < 60) return `${m} m ${rem} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m - h * 60} m`;
}

/**
 * Format a Date or ISO string as a relative time ("2 minutes ago", "just now").
 */
export function formatRelativeTime(
  input: string | number | Date | null | undefined,
): string {
  if (input == null) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const past = diff >= 0;

  const sec = Math.round(abs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return past ? `${sec} seconds ago` : `in ${sec} seconds`;
  const min = Math.round(sec / 60);
  if (min < 60) return past ? `${min} minute${min === 1 ? "" : "s"} ago` : `in ${min} minutes`;
  const hr = Math.round(min / 60);
  if (hr < 24) return past ? `${hr} hour${hr === 1 ? "" : "s"} ago` : `in ${hr} hours`;
  const day = Math.round(hr / 24);
  if (day < 30) return past ? `${day} day${day === 1 ? "" : "s"} ago` : `in ${day} days`;
  const mo = Math.round(day / 30);
  if (mo < 12) return past ? `${mo} month${mo === 1 ? "" : "s"} ago` : `in ${mo} months`;
  const yr = Math.round(mo / 12);
  return past ? `${yr} year${yr === 1 ? "" : "s"} ago` : `in ${yr} years`;
}

/**
 * Format an ISO string as an absolute local timestamp.
 */
export function formatDateTime(
  input: string | number | Date | null | undefined,
): string {
  if (input == null) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Shorten a cuid/uuid for compact display.
 */
export function shortId(id: string | null | undefined, head = 6, tail = 4): string {
  if (!id) return "—";
  if (id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
