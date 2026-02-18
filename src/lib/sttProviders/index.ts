/**
 * STT Providers - Production implementations
 *
 * Exports:
 * - DeepgramSTTProvider, createDeepgramProvider
 * - WhisperSTTProvider, createWhisperProvider
 * - STTRateLimiter, getGlobalRateLimiter
 * - createProductionSTTRegistry, getSTTRegistry, resetSTTRegistry
 * - STTAuthContext, checkRateLimit, validateAuth
 */

export { DeepgramSTTProvider, createDeepgramProvider } from './deepgramProvider';
export type { DeepgramProviderConfig } from './deepgramProvider';

export { WhisperSTTProvider, createWhisperProvider } from './whisperProvider';
export type { WhisperProviderConfig } from './whisperProvider';

export { STTRateLimiter, getGlobalRateLimiter } from './rateLimit';
export type { RateLimitConfig, RateLimitResult } from './rateLimit';

export {
  createProductionSTTRegistry,
  getSTTRegistry,
  resetSTTRegistry,
  getRateLimitStatus,
  checkRateLimit,
  validateAuth,
  ProviderPriority,
} from './factory';
export type { STTAuthContext } from './factory';
