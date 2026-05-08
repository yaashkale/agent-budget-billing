import { randomUUID } from "node:crypto";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentRunStep = {
  stepId: string;
  tool: string;
  description: string;
  status: "queued" | "running" | "completed" | "skipped" | "failed";
  outputSummary: string | null;
};

export type AgentRunRecord = {
  runId: string;
  publisherSlug: string;
  prompt: string;
  targetAddress: string;
  status: AgentRunStatus;
  budgetAllocatedUsdcMicros: number;
  budgetSpentUsdcMicros: number;
  resultSummary: string | null;
  resultArtifact: {
    headline: string;
    executiveSummary: string;
    findings: string[];
    recommendation: string;
    riskLevel: "low" | "medium";
    spendSummary: {
      allocatedUsdcMicros: number;
      spentUsdcMicros: number;
      remainingUsdcMicros: number;
      paidToolCalls: number;
    };
    sources: Array<{
      tool: string;
      endpointPath: string;
      description: string;
    }>;
  } | null;
  errorMessage: string | null;
  steps: AgentRunStep[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const runs = new Map<string, AgentRunRecord>();

export function createRun(input: {
  publisherSlug?: string;
  prompt: string;
  targetAddress: string;
  budgetAllocatedUsdcMicros: number;
}) {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const steps: AgentRunStep[] = [
    {
      stepId: randomUUID(),
      tool: "wallet_summary",
      description: "Fetch wallet summary for the target address",
      status: "queued",
      outputSummary: null,
    },
    {
      stepId: randomUUID(),
      tool: "recent_activity",
      description: "Fetch recent activity for the same address",
      status: "queued",
      outputSummary: null,
    },
    {
      stepId: randomUUID(),
      tool: "holder_distribution",
      description: "Estimate token holder concentration for the same target",
      status: "queued",
      outputSummary: null,
    },
    {
      stepId: randomUUID(),
      tool: "risk_flags",
      description: "Generate heuristic risk flags from the collected results",
      status: "queued",
      outputSummary: null,
    },
    {
      stepId: randomUUID(),
      tool: "llm_analysis",
      description: "Synthesize the collected tool output into a human-readable brief",
      status: "queued",
      outputSummary: null,
    },
    {
      stepId: randomUUID(),
      tool: "final_brief",
      description: "Generate a brief from the collected results",
      status: "queued",
      outputSummary: null,
    },
  ];

  const run: AgentRunRecord = {
    runId,
    publisherSlug: input.publisherSlug ?? "wallet-summary",
    prompt: input.prompt,
    targetAddress: input.targetAddress,
    status: "queued",
    budgetAllocatedUsdcMicros: input.budgetAllocatedUsdcMicros,
    budgetSpentUsdcMicros: 0,
    resultSummary: null,
    resultArtifact: null,
    errorMessage: null,
    steps,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };

  runs.set(runId, run);
  return run;
}

export function updateRunStep(
  runId: string,
  tool: string,
  input: {
    status: AgentRunStep["status"];
    outputSummary?: string | null;
  }
) {
  const existing = runs.get(runId);
  if (!existing) {
    return null;
  }

  const updated: AgentRunRecord = {
    ...existing,
    steps: existing.steps.map((step) =>
      step.tool === tool
        ? {
            ...step,
            status: input.status,
            outputSummary: input.outputSummary ?? step.outputSummary,
          }
        : step
    ),
  };

  runs.set(runId, updated);
  return updated;
}

export function markRunStarted(runId: string) {
  const existing = runs.get(runId);
  if (!existing) {
    return null;
  }

  const startedAt = existing.startedAt ?? new Date().toISOString();
  const updated: AgentRunRecord = {
    ...existing,
    status: "running",
    startedAt,
  };

  runs.set(runId, updated);
  return updated;
}

export function completeRun(
  runId: string,
  input: {
    budgetSpentUsdcMicros: number;
    resultSummary: string;
    resultArtifact?: AgentRunRecord["resultArtifact"];
  }
) {
  const existing = runs.get(runId);
  if (!existing) {
    return null;
  }

  const completedAt = new Date().toISOString();
  const updated: AgentRunRecord = {
    ...existing,
    status: "succeeded",
    budgetSpentUsdcMicros: input.budgetSpentUsdcMicros,
    resultSummary: input.resultSummary,
    resultArtifact: input.resultArtifact ?? existing.resultArtifact,
    errorMessage: null,
    completedAt,
  };

  runs.set(runId, updated);
  return updated;
}

export function failRun(
  runId: string,
  input: {
    errorMessage: string;
    budgetSpentUsdcMicros?: number;
  }
) {
  const existing = runs.get(runId);
  if (!existing) {
    return null;
  }

  const completedAt = new Date().toISOString();
  const updated: AgentRunRecord = {
    ...existing,
    status: "failed",
    resultArtifact: null,
    budgetSpentUsdcMicros:
      input.budgetSpentUsdcMicros ?? existing.budgetSpentUsdcMicros,
    errorMessage: input.errorMessage,
    completedAt,
  };

  runs.set(runId, updated);
  return updated;
}

export function getRun(runId: string) {
  return runs.get(runId) ?? null;
}

export function listRuns() {
  return Array.from(runs.values());
}
