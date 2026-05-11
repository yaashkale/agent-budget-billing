import {
  completeRun,
  createRun,
  failRun,
  getRun,
  listRuns,
  markRunStarted,
  updateRunStep,
  type AgentRunRecord,
} from "./agent-store.js";

const DEFAULT_RUN_BUDGET_USDC_MICROS = Number(
  process.env.DEFAULT_RUN_BUDGET_USDC_MICROS ?? 5_000_000
);

type WalletSummaryResult = {
  summary: string;
  shortAddress: string;
  solBalance: number;
  recentSignatureCount: number;
};

type RecentActivityResult = {
  summary: string;
  recentSignatureCount: number;
};

type HolderDistributionResult = {
  summary: string;
  source: "mock" | "helius" | "unavailable";
  concentrationScore: "low" | "medium" | "high" | "unavailable";
  top10Percentage: number;
  top20Percentage: number;
  sampledHolderAccounts: number;
};

type RiskFlagsResult = {
  summary: string;
  riskFlags: string[];
  riskLevel: "low" | "medium";
};

type LlmAnalysisResult = {
  source: "fallback" | "openai";
  model: string;
  summary: string;
  executiveSummary: string;
  findings: string[];
  recommendation: string;
  riskLevel: "low" | "medium";
};

export async function startAgentRun(input: {
  prompt: string;
  targetAddress: string;
  publisherSlug?: string;
  executeWalletSummary: (runId: string) => Promise<WalletSummaryResult>;
  executeRecentActivity: (runId: string) => Promise<RecentActivityResult>;
  executeHolderDistribution: (
    runId: string
  ) => Promise<HolderDistributionResult>;
  executeRiskFlags: (runId: string) => Promise<RiskFlagsResult>;
  executeLlmAnalysis: (
    runId: string,
    context: {
      walletSummary: WalletSummaryResult;
      recentActivity: RecentActivityResult;
      holderDistribution: HolderDistributionResult;
      riskFlags: RiskFlagsResult;
    }
  ) => Promise<LlmAnalysisResult>;
  toolCallCostUsdcMicros: number;
}): Promise<AgentRunRecord> {
  const stepOrder = [
    "wallet_summary",
    "recent_activity",
    "holder_distribution",
    "risk_flags",
    "llm_analysis",
    "final_brief",
  ] as const;
  const run = createRun({
    publisherSlug: input.publisherSlug,
    prompt: input.prompt,
    targetAddress: input.targetAddress,
    budgetAllocatedUsdcMicros: DEFAULT_RUN_BUDGET_USDC_MICROS,
  });
  let currentStep: (typeof stepOrder)[number] = "wallet_summary";
  let completedPaidToolCalls = 0;

  markRunStarted(run.runId);
  updateRunStep(run.runId, "wallet_summary", {
    status: "running",
  });

  try {
    const walletSummary = await input.executeWalletSummary(run.runId);

    updateRunStep(run.runId, "wallet_summary", {
      status: "completed",
      outputSummary: walletSummary.summary,
    });
    completedPaidToolCalls += 1;

    currentStep = "recent_activity";
    updateRunStep(run.runId, "recent_activity", {
      status: "running",
    });

    const recentActivity = await input.executeRecentActivity(run.runId);

    updateRunStep(run.runId, "recent_activity", {
      status: "completed",
      outputSummary: recentActivity.summary,
    });
    completedPaidToolCalls += 1;

    currentStep = "holder_distribution";
    updateRunStep(run.runId, "holder_distribution", {
      status: "running",
    });

    const holderDistribution = await input.executeHolderDistribution(run.runId);

    updateRunStep(run.runId, "holder_distribution", {
      status: "completed",
      outputSummary: holderDistribution.summary,
    });
    completedPaidToolCalls += 1;

    currentStep = "risk_flags";
    updateRunStep(run.runId, "risk_flags", {
      status: "running",
    });

    const riskFlags = await input.executeRiskFlags(run.runId);

    updateRunStep(run.runId, "risk_flags", {
      status: "completed",
      outputSummary: riskFlags.summary,
    });
    completedPaidToolCalls += 1;

    currentStep = "llm_analysis";
    updateRunStep(run.runId, "llm_analysis", {
      status: "running",
    });

    const llmAnalysis = await input.executeLlmAnalysis(run.runId, {
      walletSummary,
      recentActivity,
      holderDistribution,
      riskFlags,
    });

    updateRunStep(run.runId, "llm_analysis", {
      status: "completed",
      outputSummary: llmAnalysis.summary,
    });
    completedPaidToolCalls += 1;
    currentStep = "final_brief";
    updateRunStep(run.runId, "final_brief", {
      status: "completed",
      outputSummary: llmAnalysis.executiveSummary,
    });

    const resultSummary = [
      `Planner v0 completed five paid tool calls for ${walletSummary.shortAddress}.`,
      `Observed balance: ${walletSummary.solBalance} SOL.`,
      `Recent transactions seen: ${recentActivity.recentSignatureCount}.`,
      walletSummary.summary,
      recentActivity.summary,
      holderDistribution.summary,
      riskFlags.summary,
      llmAnalysis.summary,
    ].join(" ");
    const resultArtifact = {
      headline: `Wallet brief for ${walletSummary.shortAddress}`,
      executiveSummary: llmAnalysis.executiveSummary,
      findings: [
        ...llmAnalysis.findings,
        `Risk level: ${riskFlags.riskLevel}.`,
        `Risk flags: ${
          riskFlags.riskFlags.length > 0
            ? riskFlags.riskFlags.join(", ")
            : "none"
        }.`,
      ],
      recommendation: llmAnalysis.recommendation,
      riskLevel: llmAnalysis.riskLevel,
      spendSummary: {
        allocatedUsdcMicros: DEFAULT_RUN_BUDGET_USDC_MICROS,
        spentUsdcMicros: input.toolCallCostUsdcMicros * 5,
        remainingUsdcMicros:
          DEFAULT_RUN_BUDGET_USDC_MICROS - input.toolCallCostUsdcMicros * 5,
        paidToolCalls: 5,
      },
      sources: [
        {
          tool: "wallet_summary",
          endpointPath: "/p/wallet-summary",
          description: "Base wallet balance and recent signature summary.",
        },
        {
          tool: "recent_activity",
          endpointPath: "/p/recent-activity",
          description: "Shaped recent-activity view over the publisher wallet data.",
        },
        {
          tool: "holder_distribution",
          endpointPath: "/p/holder-distribution",
          description:
            "Holder concentration view from the mock or Helius-backed holder-distribution tool.",
        },
        {
          tool: "risk_flags",
          endpointPath: "/p/risk-flags",
          description: "Heuristic risk flags derived from wallet balance and activity.",
        },
        {
          tool: "llm_analysis",
          endpointPath: "/internal/llm-analysis",
          description:
            "Structured LLM synthesis over wallet summary, recent activity, holder concentration, and heuristic risk flags.",
        },
      ],
    };

    const completed = completeRun(run.runId, {
      budgetSpentUsdcMicros: input.toolCallCostUsdcMicros * 5,
      resultSummary,
      resultArtifact,
    });

    return completed ?? run;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    updateRunStep(run.runId, currentStep, {
      status: "failed",
      outputSummary: errorMessage,
    });

    const currentStepIndex = stepOrder.indexOf(currentStep);
    for (const skippedStep of stepOrder.slice(currentStepIndex + 1)) {
      updateRunStep(run.runId, skippedStep, {
        status: "skipped",
        outputSummary: "Skipped because an earlier step failed.",
      });
    }

    const failed = failRun(run.runId, {
      errorMessage,
      budgetSpentUsdcMicros:
        completedPaidToolCalls * input.toolCallCostUsdcMicros,
    });
    return failed ?? run;
  }
}

export function fetchAgentRun(runId: string) {
  return getRun(runId);
}

export function fetchAgentRuns() {
  return listRuns();
}
