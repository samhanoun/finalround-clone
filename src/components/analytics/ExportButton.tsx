'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { exportToCSV, exportToPDF } from '@/lib/export';
import { DownloadIcon } from '@/components/icons';

interface ExportButtonProps {
  data?: unknown[];
  elementId?: string;
  filename: string;
  /** The section's heading, in the user's language: the PDF's title. */
  title: string;
  disabled?: boolean;
}

/** CSV and PDF downloads of a view: two small secondary buttons. */
export function ExportButton({
  data,
  elementId,
  filename,
  title,
  disabled = false
}: ExportButtonProps) {
  const t = useTranslations('Export');
  const [exporting, setExporting] = useState(false);

  const handleCSVExport = async () => {
    if (!data || data.length === 0) {
      alert(t('noData'));
      return;
    }

    setExporting(true);
    try {
      exportToCSV(data as Record<string, unknown>[], filename);
    } catch (error) {
      console.error('CSV export failed:', error);
      alert(t('csvFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handlePDFExport = async () => {
    if (!elementId) {
      alert(t('noData'));
      return;
    }

    setExporting(true);
    try {
      await exportToPDF(elementId, filename, title);
    } catch (error) {
      console.error('PDF export failed:', error);
      alert(t('pdfFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="export-buttons">
      <button
        type="button"
        className="button buttonSmall"
        onClick={handleCSVExport}
        disabled={disabled || exporting}
        title={t('csv')}
      >
        <DownloadIcon size={16} className="export-icon" />
        {t('csvShort')}
      </button>
      <button
        type="button"
        className="button buttonSmall"
        onClick={handlePDFExport}
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
