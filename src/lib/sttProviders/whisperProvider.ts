/**
 * OpenAI Whisper STT Provider
 *
 * Production STT provider using OpenAI's Whisper API.
 * Supports transcription with automatic language detection.
 */

import OpenAI from 'openai';
import type { STTProvider, STTProviderResult } from '@/lib/sttProvider';

export interface WhisperProviderConfig {
  apiKey: string;
  /** Organization ID (optional) */
  organization?: string;
  /** Default language code (e.g., 'en') */
  language?: string;
  /** Model to use (default: 'whisper-1') */
  model?: string;
  /** API base URL for proxying (optional) */
  baseURL?: string;
}

/**
 * OpenAI Whisper STT Provider implementation.
 * Uses OpenAI's Whisper-1 model for transcription.
 */
export class WhisperSTTProvider implements STTProvider {
  readonly name = 'whisper';
  private readonly client: OpenAI;
  private readonly language: string;
  private readonly model: string;

  constructor(config: WhisperProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization,
      baseURL: config.baseURL,
      // Allow browser environment for testing; in production this runs server-side
      dangerouslyAllowBrowser: true,
    });

    this.language = config.language ?? 'en';
    this.model = config.model ?? 'whisper-1';
  }

  async transcribe(
    audio: ArrayBuffer,
    opts?: { language?: string },
  ): Promise<STTProviderResult> {
    const language = opts?.language ?? this.language;

    // Create a Blob from the ArrayBuffer
    const audioBlob = new Blob([audio], { type: 'audio/webm' });
    
    // Convert to File for OpenAI API
    const audioFile = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });

    try {
      const response = await this.client.audio.transcriptions.create({
        file: audioFile,
        model: this.model,
        language,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      // Handle both verbose_json and simple responses
      if ('text' in response) {
        return {
          text: response.text ?? '',
          isFinal: true,
          // Whisper doesn't always provide confidence, estimate from segments
          confidence: this.calculateConfidence(response),
        };
      }

      return {
        text: String(response),
        isFinal: true,
      };
    } catch (error) {
      // Provide more context on failure
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Whisper transcription failed: ${message}`);
    }
  }

  /**
   * Calculate confidence from Whisper segments (if available).
   */
  private calculateConfidence(
    response: OpenAI.Audio.Transcription,
  ): number | undefined {
    // Check for verbose_json response with segments
    if (
      'segments' in response &&
      Array.isArray(response.segments) &&
      response.segments.length > 0
    ) {
      // Average confidence across segments
      const totalConfidence = response.segments.reduce(
        (sum, seg) => sum + (seg.compression_ratio ?? 1),
        0,
      );
      // Convert compression ratio to confidence-like score (lower = better compression = more certain)
      // This is an approximation since Whisper doesn't provide direct confidence
      const avgCompression = totalConfidence / response.segments.length;
      return Math.max(0, Math.min(1, 1 - (avgCompression - 1) * 0.5));
    }

    return undefined;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple health check - list available models
      const models = await this.client.models.list();
      return models.data.some((m) => m.id === this.model);
    } catch {
      return false;
    }
  }
}

/**
 * Create a Whisper provider from environment variables.
 * Uses OPENAI_API_KEY env var.
 */
export function createWhisperProvider(): WhisperSTTProvider | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[STT] OpenAI API key not configured (OPENAI_API_KEY)');
    return null;
  }

  return new WhisperSTTProvider({
    apiKey,
    organization: process.env.OPENAI_ORG_ID,
    language: process.env.WHISPER_LANGUAGE ?? 'en',
    model: process.env.WHISPER_MODEL ?? 'whisper-1',
    baseURL: process.env.OPENAI_BASE_URL,
  });
}
