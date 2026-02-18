/**
 * Client-side SLO (Service Level Objective) instrumentation for overlay interactions
 * PRD Requirements:
 * - Overlay hide/reveal interaction <100ms
 * - Transcript to suggestion delivery <3s p75
 */

export type SLOType = 'overlay_interaction' | 'transcript_to_suggestion';

export interface SLOThreshold {
  targetMs: number;
  warningMs: number;
}

export const SLO_THRESHOLDS: Record<SLOType, SLOThreshold> = {
  overlay_interaction: {
    targetMs: 100,
    warningMs: 150,
  },
  transcript_to_suggestion: {
    targetMs: 3000,
    warningMs: 4000,
  },
};

export type SLOStatus = 'healthy' | 'warning' | 'critical';

export interface SLOMetric {
  type: SLOType;
  action: string;
  latencyMs: number;
  timestamp: number;
  status: SLOStatus;
}

export interface SLOCompliance {
  type: SLOType;
  totalSamples: number;
  withinTarget: number;
  withinWarning: number;
  p50: number;
  p95: number;
  currentStatus: SLOStatus;
}

class SLOClientTracker {
  private metrics: SLOMetric[] = [];
  private maxMetrics = 100;

  recordMetric(type: SLOType, action: string, latencyMs: number): SLOMetric {
    const threshold = SLO_THRESHOLDS[type];
    let status: SLOStatus;

    if (latencyMs <= threshold.targetMs) {
      status = 'healthy';
    } else if (latencyMs <= threshold.warningMs) {
      status = 'warning';
    } else {
      status = 'critical';
    }

    const metric: SLOMetric = {
      type,
      action,
      latencyMs,
      timestamp: Date.now(),
      status,
    };

    this.metrics.push(metric);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    return metric;
  }

  getCompliance(type: SLOType): SLOCompliance {
    const threshold = SLO_THRESHOLDS[type];
    const samples = this.metrics.filter((m) => m.type === type);

    if (samples.length === 0) {
      return {
        type,
        totalSamples: 0,
        withinTarget: 0,
        withinWarning: 0,
        p50: 0,
        p95: 0,
        currentStatus: 'healthy',
      };
    }

    const latencies = samples.map((m) => m.latencyMs).sort((a, b) => a - b);
    const withinTarget = latencies.filter((l) => l <= threshold.targetMs).length;
    const withinWarning = latencies.filter((l) => l <= threshold.warningMs).length;

    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

    // Current status based on most recent sample
    const latestSample = samples[samples.length - 1];
    const currentStatus = latestSample?.status ?? 'healthy';

    return {
      type,
      totalSamples: samples.length,
      withinTarget,
      withinWarning,
      p50,
      p95,
      currentStatus,
    };
  }

  getAllCompliance(): SLOCompliance[] {
    return [SLO_TYPE_OVERLAY_INTERACTION, SLO_TYPE_TRANSCRIPT_TO_SUGGESTION].map((type) =>
      this.getCompliance(type)
    );
  }

  getRecentMetrics(type?: SLOType, limit = 10): SLOMetric[] {
    const filtered = type ? this.metrics.filter((m) => m.type === type) : this.metrics;
    return filtered.slice(-limit);
  }

  clear(): void {
    this.metrics = [];
  }
}

export const SLO_TYPE_OVERLAY_INTERACTION: SLOType = 'overlay_interaction';
export const SLO_TYPE_TRANSCRIPT_TO_SUGGESTION: SLOType = 'transcript_to_suggestion';

export const sloClient = new SLOClientTracker();

/**
 * Measure and record an overlay interaction latency
 */
export function measureOverlayInteraction(
  action: string,
  fn: () => void
): void {
  const start = performance.now();
  fn();
  const latency = Math.round(performance.now() - start);
  sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, action, latency);
}

/**
 * Track transcript-to-suggestion latency
 * Call with transcript timestamp, and again when suggestion arrives
 */
export function trackTranscriptToSuggestion(
  transcriptTimestamp: number,
  suggestionTimestamp: number
): SLOMetric | null {
  const latency = suggestionTimestamp - transcriptTimestamp;
  if (latency < 0) return null;
  
  return sloClient.recordMetric(
    SLO_TYPE_TRANSCRIPT_TO_SUGGESTION,
    'transcript_to_suggestion',
    latency
  );
}

/**
 * Format latency for display
 */
export function formatLatency(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Get status color class
 */
export function getStatusColor(status: SLOStatus): string {
  switch (status) {
    case 'healthy':
      return 'success';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'error';
    default:
      return '';
  }
}

/**
 * Get status emoji
 */
export function getStatusEmoji(status: SLOStatus): string {
  switch (status) {
    case 'healthy':
      return '✓';
    case 'warning':
      return '⚠';
    case 'critical':
      return '✗';
    default:
      return '?';
  }
}
