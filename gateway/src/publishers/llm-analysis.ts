const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? null;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export type LlmAnalysisInput = {
  prompt: string;
  targetAddress: string;
  walletSummary: {
    shortAddress: string;
    summary: string;
    solBalance: number;
    recentSignatureCount: number;
  };
  recentActivity: {
    summary: string;
    recentSignatureCount: number;
  };
  holderDistribution: {
    summary: string;
    source: "mock" | "helius";
    concentrationScore: "low" | "medium" | "high";
    top10Percentage: number;
    top20Percentage: number;
    sampledHolderAccounts: number;
  };
  riskFlags: {
    summary: string;
    riskFlags: string[];
    riskLevel: "low" | "medium";
  };
};

export type LlmAnalysisResponse = {
  source: "fallback" | "openai";
  model: string;
  summary: string;
  executiveSummary: string;
  findings: string[];
  recommendation: string;
  riskLevel: "low" | "medium";
};

type OpenAiStructuredResponse = {
  summary: string;
  executiveSummary: string;
  findings: string[];
  recommendation: string;
  riskLevel: "low" | "medium";
};

function buildFallbackAnalysis(input: LlmAnalysisInput): LlmAnalysisResponse {
  const walletRiskTone =
    input.riskFlags.riskLevel === "medium"
      ? "low-context"
      : input.holderDistribution.concentrationScore === "high"
        ? "concentrated"
        : "limited-risk";

  const executiveSummary =
    walletRiskTone === "low-context"
      ? `This wallet looks low-context based on the currently paid toolset: balance and activity are thin enough that you should treat it as an under-explained counterparty.`
      : walletRiskTone === "concentrated"
        ? `This target does not show obvious activity risk, but the holder-distribution signal suggests concentrated ownership that could matter before acting.`
        : `This target does not show obvious heuristic risk from the current tool bundle, though confidence is still limited by the narrow scope of inputs.`;

  const findings = [
    `Wallet summary: ${input.walletSummary.summary}`,
    `Recent activity: ${input.recentActivity.summary}`,
    `Holder distribution: top 10 holders control ${input.holderDistribution.top10Percentage}% of observed supply (${input.holderDistribution.source} source).`,
    `Risk flags: ${
      input.riskFlags.riskFlags.length > 0
        ? input.riskFlags.riskFlags.join(", ")
        : "none"
    }.`,
  ];

  const recommendation =
    input.riskFlags.riskLevel === "medium"
      ? "Ask for more context before acting: verify ownership history, related wallets, and any off-chain explanation for sparse activity."
      : input.holderDistribution.concentrationScore === "high"
        ? "Validate whether major holder accounts belong to the same entity before treating the asset as broadly distributed."
        : "Use this as a first-pass signal only and enrich with more transaction history or token metadata before making a stronger call.";

  return {
    source: "fallback",
    model: "deterministic-fallback",
    summary: `Fallback analysis marked ${input.walletSummary.shortAddress} as ${input.riskFlags.riskLevel} risk with ${input.holderDistribution.concentrationScore} holder concentration.`,
    executiveSummary,
    findings,
    recommendation,
    riskLevel: input.riskFlags.riskLevel,
  };
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeResponse = payload as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof maybeResponse.output_text === "string" && maybeResponse.output_text) {
    return maybeResponse.output_text;
  }

  const messageText = maybeResponse.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text" && content.text);

  return typeof messageText?.text === "string" ? messageText.text : null;
}

export async function generateLlmAnalysis(
  input: LlmAnalysisInput
): Promise<LlmAnalysisResponse> {
  if (!OPENAI_API_KEY) {
    return buildFallbackAnalysis(input);
  }

  const instructions =
    "You are a concise onchain risk analyst. Given wallet and token concentration signals, produce a short executive summary, 3-5 findings, a practical recommendation, and a low or medium risk level. Do not invent facts outside the provided tool outputs. Keep findings concrete and readable for a hackathon demo judge.";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
      },
      executiveSummary: {
        type: "string",
      },
      findings: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "string",
        },
      },
      recommendation: {
        type: "string",
      },
      riskLevel: {
        type: "string",
        enum: ["low", "medium"],
      },
    },
    required: [
      "summary",
      "executiveSummary",
      "findings",
      "recommendation",
      "riskLevel",
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions,
      input: JSON.stringify(input, null, 2),
      max_output_tokens: 500,
      text: {
        format: {
          type: "json_schema",
          name: "wallet_brief",
          strict: true,
          schema,
        },
      },
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI llm-analysis failed: ${response.status} ${body}`);
  }

  const payload = JSON.parse(body) as unknown;
  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI llm-analysis returned no text output");
  }

  const parsed = JSON.parse(outputText) as OpenAiStructuredResponse;

  return {
    source: "openai",
    model: OPENAI_MODEL,
    summary: parsed.summary,
    executiveSummary: parsed.executiveSummary,
    findings: parsed.findings,
    recommendation: parsed.recommendation,
    riskLevel: parsed.riskLevel,
  };
}
