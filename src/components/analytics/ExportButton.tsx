'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { exportToCSV, exportToPDF } from '@/lib/export';
import { DownloadIcon } from '@/components/icons';

interface ExportButtonProps {
  /** The rows of the view, with column names in the user's language: the CSV, and the PDF's table. */
  data?: unknown[];
  filename: string;
  /** The section's heading, in the user's language: the PDF's title. */
  title: string;
  disabled?: boolean;
}

/** CSV and PDF downloads of a view: two small secondary buttons. */
export function ExportButton({
  data,
  filename,
  title,
  disabled = false
}: ExportButtonProps) {
  const t = useTranslations('Export');
  const [exporting, setExporting] = useState(false);

  const run = (write: (rows: Record<string, unknown>[]) => void, failed: string) => {
    if (!data || data.length === 0) {
      alert(t('noData'));
      return;
    }

    setExporting(true);
    try {
      write(data as Record<string, unknown>[]);
    } catch (error) {
      console.error('Export failed:', error);
      alert(failed);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="export-buttons">
      <button
        type="button"
        className="button buttonSmall"
        onClick={() => run((rows) => exportToCSV(rows, filename), t('csvFailed'))}
        disabled={disabled || exporting}
        title={t('csv')}
      >
        <DownloadIcon size={16} className="export-icon" />
        {t('csvShort')}
      </button>
      <button
        type="button"
        className="button buttonSmall"
        onClick={() => run((rows) => exportToPDF(rows, filename, title), t('pdfFailed'))}
        disabled={disabled || exporting}
        title={t('pdf')}
      >
        <DownloadIcon size={16} className="export-icon" />
        {t('pdfShort')}
      </button>

      <style jsx>{`
        .export-buttons {
          display: flex;
          gap: 8px;
        }

        .export-buttons :global(.export-icon) {
          color: var(--text-3);
        }
      `}</style>
    </div>
  );
}
