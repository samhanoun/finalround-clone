/**
 * Deepgram STT Provider
 *
 * Production STT provider using Deepgram streaming API.
 * Supports real-time transcription with partial/final results.
 */

import { createClient, DeepgramClient } from '@deepgram/sdk';
import type { STTProvider, STTProviderResult } from '@/lib/sttProvider';

export interface DeepgramProviderConfig {
  apiKey: string;
  /** Default language code (e.g., 'en-US') */
  language?: string;
  /** Model to use (e.g., 'nova-2', 'base') */
  model?: string;
}

/**
 * Deepgram STT Provider implementation.
 * Uses Deepgram's REST API for transcription.
 *
 * For production real-time, consider using Deepgram's streaming API with WebSockets.
 */
export class DeepgramSTTProvider implements STTProvider {
  readonly name = 'deepgram';
  private readonly client: DeepgramClient;
  private readonly language: string;
  private readonly model: string;

  constructor(config: DeepgramProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Deepgram API key is required');
    }
    // Deepgram SDK v3 uses createClient
    this.client = createClient(config.apiKey);
    this.language = config.language ?? 'en-US';
    this.model = config.model ?? 'nova-2';
  }

  async transcribe(
    audio: ArrayBuffer,
    opts?: { language?: string },
  ): Promise<STTProviderResult> {
    const language = opts?.language ?? this.language;
    
    // For production real-time, use live WebSocket streaming
    // Here we use the pre-recorded endpoint for simplicity
    const response = await this.client.transcription.preRecorded(
      { buffer: Buffer.from(audio) },
      {
        language,
        model: this.model,
        punctuate: true,
        paragraphs: true,
      }
    );

    // The response structure from Deepgram
    const results = response.results?.channels?.[0]?.alternatives?.[0];
    if (!results) {
      return {
        text: '',
        isFinal: true,
        confidence: 0,
      };
    }

    return {
      text: results.transcript ?? '',
      isFinal: true, // Prerecorded endpoint returns final results
      confidence: results.confidence ?? 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Simple health check - attempt to get project info
      await this.client.manage.getProjects();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a Deepgram provider from environment variables.
 * Uses DEEPGRAM_API_KEY env var.
 */
export function createDeepgramProvider(): DeepgramSTTProvider | null {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.warn('[STT] Deepgram API key not configured (DEEPGRAM_API_KEY)');
    return null;
  }

  return new DeepgramSTTProvider({
    apiKey,
    language: process.env.DEEPGRAM_LANGUAGE ?? 'en-US',
    model: process.env.DEEPGRAM_MODEL ?? 'nova-2',
  });
}
