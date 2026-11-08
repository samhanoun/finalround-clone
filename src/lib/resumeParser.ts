import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

// Uploads are read from the bytes the server received (see /api/resume/upload), so nothing here
// downloads from storage with the service role: a stored bucket or path is never trusted to choose a file.

/** Text from a PDF, Word or plain-text file (résumés, and materials for goals). */
export async function extractDocumentText(
  buffer: ArrayBuffer,
  filename: string,
  contentType: string,
): Promise<{ text: string; data: Record<string, unknown> }> {
  const storagePath = filename.toLowerCase();
  let text = '';
  let extractedData: Record<string, unknown> = {};

  try {
    if (contentType === 'application/pdf' || storagePath.endsWith('.pdf')) {
      // Parse PDF
      const pdfBuffer = Buffer.from(buffer);
      const pdfParser = new PDFParse({ data: pdfBuffer });
      try {
        // No "-- 1 of 2 --" page markers in the text the models and the ATS check read.
        const pdfData = await pdfParser.getText({ pageJoiner: '' });
        text = pdfData.text;
        extractedData = {
          pages: pdfData.pages?.length ?? 0,
        };
      } finally {
        // The server keeps running: free pdf.js's document and its worker state.
        await pdfParser.destroy().catch(() => undefined);
      }
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
