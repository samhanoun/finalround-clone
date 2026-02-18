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
        📊 CSV
      </button>
      <button 
        className="export-btn pdf"
        onClick={handlePDFExport}
        disabled={disabled || exporting}
        title="Export to PDF"
      >
        📄 PDF
      </button>

      <style jsx>{`
        .export-buttons {
          display: flex;
          gap: 8px;
        }
        
        .export-btn {
          padding: 8px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          background: white;
          cursor: pointer;
          font-size: 0.875rem;
          font-weight: 500;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .export-btn:hover:not(:disabled) {
          background: #f9fafb;
          border-color: #d1d5db;
        }
        
        .export-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .export-btn.csv {
          color: #10b981;
        }
        
        .export-btn.pdf {
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}
