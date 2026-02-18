import { createAdminClient } from '@/lib/supabase/admin';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

const admin = createAdminClient();

/**
 * Parse a resume document (PDF or DOCX) and extract text content
 */
export async function parseResumeDocument(
  storageBucket: string,
  storagePath: string
): Promise<{ text: string; data: Record<string, unknown> }> {
  // Download the file from storage
  const { data: fileData, error: downloadError } =
    await admin.storage.from(storageBucket).download(storagePath);

  if (downloadError) {
    throw new Error(`Failed to download file: ${downloadError.message}`);
  }

  if (!fileData) {
    throw new Error('No file data received');
  }

  const buffer = await fileData.arrayBuffer();
  const contentType = fileData.type || 'application/octet-stream';

  let text = '';
  let extractedData: Record<string, unknown> = {};

  try {
    if (contentType === 'application/pdf' || storagePath.endsWith('.pdf')) {
      // Parse PDF
      const pdfBuffer = Buffer.from(buffer);
      const pdfParser = new PDFParse({ data: pdfBuffer });
      const pdfData = await pdfParser.getText();
      text = pdfData.text;
      extractedData = {
        pages: pdfData.pages?.length ?? 0,
      };
    } else if (
      contentType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      storagePath.endsWith('.docx') ||
      storagePath.endsWith('.doc')
    ) {
      // Parse DOCX
      const docxBuffer = Buffer.from(buffer);
      const result = await mammoth.extractRawText({ buffer: docxBuffer });
      text = result.value;
      extractedData = {
        warnings: result.messages,
      };
    } else {
      // Try to read as plain text
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(buffer);
    }
  } catch (parseError) {
    console.error('Parse error:', parseError);
    throw new Error(
      `Failed to parse document: ${parseError instanceof Error ? parseError.message : 'Unknown error'
      }`
    );
  }

  // Clean up the extracted text
  text = cleanExtractedText(text);

  return { text, data: extractedData };
}

/**
 * Clean up extracted text by removing extra whitespace and normalizing
 */
function cleanExtractedText(text: string): string {
  return (
    text
      // Replace multiple whitespace with single space
      .replace(/\s+/g, ' ')
      // Remove whitespace at start/end of lines
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      // Remove multiple empty lines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Extract structured data from resume text using basic patterns
 */
export function extractResumeData(text: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    lineCount: text.split('\n').length,
  };

  // Extract email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    data.email = emailMatch[0];
  }

  // Extract phone numbers
  const phoneMatches = text.match(/[\+]?[(]?[0-9]{1,3}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}/g);
  if (phoneMatches) {
    data.phones = phoneMatches;
  }

  // Extract URLs
  const urlMatches = text.match(/https?:\/\/[^\s]+/g);
  if (urlMatches) {
    data.urls = urlMatches;
  }

  // Extract years (for experience detection)
  const yearMatches = text.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches) {
    data.years = [...new Set(yearMatches)].sort();
  }

  return data;
}
