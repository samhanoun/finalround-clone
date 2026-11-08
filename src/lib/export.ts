import Papa from 'papaparse';
import jsPDF from 'jspdf';

export interface ExportOptions {
  filename: string;
  format: 'csv' | 'pdf';
}

/** Hands the browser a file to save. */
function save(blob: Blob, name: string): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', name);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // After the click has been handled: the download keeps its own copy.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Export data to CSV format
 */
export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string
): void {
  const csv = Papa.unparse(data);
  save(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
}

/** Every column that appears in the rows, in first-seen order. */
export function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }
  return columns;
}

const cell = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/**
 * The same rows as the CSV, as a PDF: the view's title, then a table. It is
 * set as text with jsPDF rather than a screenshot of the page, so it reads in
 * print whatever the app's theme, and its text can be copied. Columns of
 * numbers are right-aligned; a long table runs over pages, repeating the header.
 */
export function exportToPDF<T extends Record<string, unknown>>(rows: T[], filename: string, title: string): void {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const columns = columnsOf(rows);
  // A column of numbers (and blanks) is right-aligned, header included.
  const numeric = columns.map(
    (column) => rows.some((row) => typeof row[column] === 'number') && rows.every((row) => row[column] == null || typeof row[column] === 'number'),
  );
  const width = (pageWidth - margin * 2) / Math.max(columns.length, 1);
  const pad = 6;
  const line = 13;

  pdf.setTextColor(20, 20, 21);
  pdf.setDrawColor(210, 210, 214);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  let y = margin + 4;
  for (const piece of pdf.splitTextToSize(title, pageWidth - margin * 2) as string[]) {
    pdf.text(piece, margin, y);
    y += 20;
  }
  y += 8;

  const drawRow = (values: unknown[], header: boolean) => {
    const font = () => {
      pdf.setFont('helvetica', header ? 'bold' : 'normal');
      pdf.setFontSize(10);
    };
    font();
    const wrapped = values.map((value) => pdf.splitTextToSize(cell(value), width - pad * 2) as string[]);
    const height = Math.max(1, ...wrapped.map((lines) => lines.length)) * line + pad;
    if (y + height > pageHeight - margin) {
      pdf.addPage();
      y = margin;
      if (!header) {
        drawRow(columns, true);
        font();
      }
    }
    wrapped.forEach((lines, i) => {
      const right = numeric[i];
      const x = right ? margin + width * (i + 1) - pad : margin + width * i + (i === 0 ? 0 : pad);
      lines.forEach((text, j) => pdf.text(text, x, y + line * (j + 1) - 3, right ? { align: 'right' } : undefined));
    });
    y += height;
    pdf.line(margin, y, pageWidth - margin, y);
  };

  drawRow(columns, true);
  for (const row of rows) drawRow(columns.map((column) => row[column]), false);

  pdf.save(`${filename}.pdf`);
}
