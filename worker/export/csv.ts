/** CSV for the export (T-018 Step 2): UTF-8 with BOM, CRLF, and text that could be read as a formula is quoted safe. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function csvCell(value: unknown): string {
  const raw = toText(value);
  // Keep user-entered text from becoming an Excel formula when the file is opened.
  const safe = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvFile(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}
