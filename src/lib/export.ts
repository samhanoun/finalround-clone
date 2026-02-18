import Papa from 'papaparse';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface ExportOptions {
  filename: string;
  format: 'csv' | 'pdf';
}

/**
 * Export data to CSV format
 */
export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string
): void {
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export data to PDF format
 */
export function exportToPDF(
  elementId: string,
  filename: string,
  title?: string
): void {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error('Element not found:', elementId);
    return;
  }

  html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  }).then((canvas) => {
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
    const imgX = (pdfWidth - imgWidth * ratio) / 2;
    const imgY = 20;

    if (title) {
      pdf.setFontSize(16);
      pdf.text(title, pdfWidth / 2, 10, { align: 'center' });
    }

    const finalWidth = imgWidth * ratio;
    const finalHeight = imgHeight * ratio;

    pdf.addImage(imgData, 'PNG', imgX, imgY, finalWidth, finalHeight);
    pdf.save(`${filename}.pdf`);
  });
}

/**
 * Export analytics summary to PDF with custom content
 */
export function exportAnalyticsReport(
  data: {
    funnel?: unknown[];
    cohort?: unknown[];
    stats?: Record<string, unknown>;
  },
  filename: string
): void {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  let yPos = 20;

  // Title
  pdf.setFontSize(20);
  pdf.setTextColor(59, 130, 246);
  pdf.text('Analytics Report', pageWidth / 2, yPos, { align: 'center' });
  yPos += 10;

  // Date
  pdf.setFontSize(10);
  pdf.setTextColor(107, 114, 128);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, yPos, { align: 'center' });
  yPos += 15;

  // Stats section
  if (data.stats) {
    pdf.setFontSize(14);
    pdf.setTextColor(31, 41, 55);
    pdf.text('Key Metrics', 14, yPos);
    yPos += 8;

    pdf.setFontSize(10);
    Object.entries(data.stats).forEach(([key, value]) => {
      pdf.setTextColor(55, 65, 81);
      pdf.text(`${key}: ${String(value)}`, 14, yPos);
      yPos += 6;
    });
    yPos += 10;
  }

  // Funnel section
  if (data.funnel && data.funnel.length > 0) {
    pdf.setFontSize(14);
    pdf.setTextColor(31, 41, 55);
    pdf.text('Conversion Funnel', 14, yPos);
    yPos += 8;

    pdf.setFontSize(9);
    (data.funnel as Array<{name: string; value: number; conversionRate: number}>).forEach((stage) => {
      pdf.setTextColor(55, 65, 81);
      pdf.text(
        `${stage.name}: ${stage.value.toLocaleString()} users (${stage.conversionRate.toFixed(1)}% conversion)`,
        14,
        yPos
      );
      yPos += 5;
    });
    yPos += 10;
  }

  // Cohort section
  if (data.cohort && data.cohort.length > 0) {
    pdf.setFontSize(14);
    pdf.setTextColor(31, 41, 55);
    pdf.text('Cohort Retention', 14, yPos);
    yPos += 8;

    pdf.setFontSize(9);
    (data.cohort as Array<{cohortDate: string; cohortSize: number; retention: number[]}>).forEach((cohort) => {
      pdf.setTextColor(55, 65, 81);
      const retentionStr = cohort.retention.map((r) => `${(r * 100).toFixed(0)}%`).join(', ');
      pdf.text(
        `${cohort.cohortDate}: ${cohort.cohortSize} users - [${retentionStr}]`,
        14,
        yPos
      );
      yPos += 5;
    });
  }

  pdf.save(`${filename}.pdf`);
}

/**
 * Generate downloadable report as blob
 */
export function generateReportBlob(
  content: string,
  mimeType: string = 'text/plain'
): Blob {
  return new Blob([content], { type: mimeType });
}
