'use client';

import { useState } from 'react';
import { exportToCSV, exportToPDF } from '@/lib/export';

interface ExportButtonProps {
  data?: unknown[];
  elementId?: string;
  filename: string;
  label?: string;
  disabled?: boolean;
}

export function ExportButton({
  data,
  elementId,
  filename,
  label = 'Export',
  disabled = false
}: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleCSVExport = async () => {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    setExporting(true);
    try {
      exportToCSV(data as Record<string, unknown>[], filename);
    } catch (error) {
      console.error('CSV export failed:', error);
      alert('Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  const handlePDFExport = async () => {
    if (!elementId) {
      alert('No element to export');
      return;
    }

    setExporting(true);
    try {
      await exportToPDF(elementId, filename, `${filename} Report`);
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="export-buttons">
      <button
        className="export-btn csv"
        onClick={handleCSVExport}
        disabled={disabled || exporting}
        title="Export to CSV"
      >
        CSV
      </button>
      <button
        className="export-btn pdf"
        onClick={handlePDFExport}
        disabled={disabled || exporting}
        title="Export to PDF"
      >
        PDF
      </button>

      <style jsx>{`
        .export-buttons {
          display: flex;
          gap: 8px;
        }

        .export-btn {
          min-height: 40px;
          padding: 0 16px;
          border: 1px solid var(--line-strong);
          border-radius: 10px;
          background: var(--deck-2);
          color: var(--paper);
          cursor: pointer;
          font: inherit;
          font-size: 14px;
          font-weight: 500;
          transition: background 120ms ease, border-color 120ms ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .export-btn:hover:not(:disabled) {
          background: var(--well);
          border-color: var(--line-strong);
        }

        .export-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

      `}</style>
    </div>
  );
}
