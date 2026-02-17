export type CopilotRetentionPolicy = {
  eventsDays: number;
  summariesDays: number;
  sessionsDays: number;
};

export type CopilotRetentionOptions = {
  now?: Date;
  policy?: Partial<CopilotRetentionPolicy>;
  dryRun?: boolean;
};

export type CopilotRetentionCutoffs = {
  eventsBeforeIso: string;
  summariesBeforeIso: string;
  sessionsBeforeIso: string;
};

export type CopilotRetentionResult = {
  dryRun: boolean;
  policy: CopilotRetentionPolicy;
  cutoffs: CopilotRetentionCutoffs;
  deleted: {
    events: number;
    summaries: number;
    sessions: number;
  };
};

const DEFAULT_POLICY: CopilotRetentionPolicy = {
  eventsDays: 30,
  summariesDays: 90,
  sessionsDays: 90,
};

function daysAgoIso(now: Date, days: number) {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms).toISOString();
}

export function resolveCopilotRetentionPolicy(input?: Partial<CopilotRetentionPolicy>): CopilotRetentionPolicy {
  return {
    eventsDays: input?.eventsDays ?? DEFAULT_POLICY.eventsDays,
    summariesDays: input?.summariesDays ?? DEFAULT_POLICY.summariesDays,
    sessionsDays: input?.sessionsDays ?? DEFAULT_POLICY.sessionsDays,
  };
}

export function buildCopilotRetentionCutoffs(options: CopilotRetentionOptions = {}): {
  policy: CopilotRetentionPolicy;
  cutoffs: CopilotRetentionCutoffs;
} {
  const now = options.now ?? new Date();
  const policy = resolveCopilotRetentionPolicy(options.policy);

  return {
    policy,
    cutoffs: {
      eventsBeforeIso: daysAgoIso(now, policy.eventsDays),
      summariesBeforeIso: daysAgoIso(now, policy.summariesDays),
      sessionsBeforeIso: daysAgoIso(now, policy.sessionsDays),
    },
  };
}

type RetentionAdminClient = {
  from: (table: string) => {
    delete: () => {
      lt: (column: string, value: string) => Promise<{ count: number | null; error: { code?: string | null } | null }>;
      eq: (column: string, value: string) => {
        lt: (column2: string, value2: string) => Promise<{ count: number | null; error: { code?: string | null } | null }>;
      };
      in: (column: string, values: string[]) => {
        lt: (column2: string, value2: string) => Promise<{ count: number | null; error: { code?: string | null } | null }>;
      };
    };
  };
};

export async function runCopilotRetentionSweep(
  admin: RetentionAdminClient,
  options: CopilotRetentionOptions = {},
): Promise<CopilotRetentionResult> {
  const { policy, cutoffs } = buildCopilotRetentionCutoffs(options);
  const dryRun = options.dryRun ?? true;

  if (dryRun) {
    return {
      dryRun,
      policy,
      cutoffs,
      deleted: { events: 0, summaries: 0, sessions: 0 },
    };
  }

  const [eventsRes, summariesRes, sessionsRes] = await Promise.all([
    admin.from('copilot_events').delete().lt('created_at', cutoffs.eventsBeforeIso),
    admin.from('copilot_summaries').delete().lt('created_at', cutoffs.summariesBeforeIso),
    admin
      .from('copilot_sessions')
      .delete()
      .in('status', ['stopped', 'expired'])
      .lt('created_at', cutoffs.sessionsBeforeIso),
  ]);

  if (eventsRes.error || summariesRes.error || sessionsRes.error) {
    throw new Error('copilot_retention_sweep_failed');
  }

  return {
    dryRun,
    policy,
    cutoffs,
    deleted: {
      events: eventsRes.count ?? 0,
      summaries: summariesRes.count ?? 0,
      sessions: sessionsRes.count ?? 0,
    },
  };
}

export const copilotRetentionPolicyHooks = {
  default: DEFAULT_POLICY,
  resolve: resolveCopilotRetentionPolicy,
  cutoffs: buildCopilotRetentionCutoffs,
  runSweep: runCopilotRetentionSweep,
};
