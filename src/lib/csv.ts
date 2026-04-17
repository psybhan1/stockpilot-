/**
 * Tiny CSV writer + client-side download helper. Used by the
 * margin, variance, and inventory pages so managers can dump the
 * current table view into a spreadsheet (or send to an accountant).
 *
 * Rolling our own instead of pulling a library because the needs
 * are trivial — quote values that contain a comma/quote/newline,
 * escape double quotes, BOM prefix so Excel opens UTF-8 correctly.
 */

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | null | undefined;
};

export function toCsv<Row>(rows: Row[], columns: Array<CsvColumn<Row>>): string {
  const headerLine = columns.map((c) => escapeCell(c.header)).join(",");
  const bodyLines = rows.map((row) =>
    columns
      .map((c) => {
        const v = c.value(row);
        if (v === null || v === undefined) return "";
        return escapeCell(String(v));
      })
      .join(",")
  );
  // Excel assumes legacy Windows-1252 unless it sees a UTF-8 BOM.
  // Accented supplier names (Saq, Café Américano) turn into garbage
  // without this. 3 bytes is a small price.
  return "\uFEFF" + [headerLine, ...bodyLines].join("\r\n");
}

function escapeCell(raw: string): string {
  const needsQuotes = /[",\r\n]/.test(raw);
  if (!needsQuotes) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

/**
 * Client-only: kick off a CSV file download. Returns void; callers
 * don't need to clean up the blob URL (we revoke it on the next tick).
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so Safari/iOS has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Format "2026-04-17" for filenames — ISO date, no timezone weirdness.
 */
export function isoDateForFilename(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
