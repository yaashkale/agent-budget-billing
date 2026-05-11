export type RunReportView = {
  runId: string;
  status: string;
  headline: string | null;
  riskLevel: "low" | "medium" | null;
  executiveSummary: string | null;
  findings: string[];
  recommendation: string | null;
  spendSummary: {
    allocatedUsdcMicros: number;
    spentUsdcMicros: number;
    remainingUsdcMicros: number;
    paidToolCalls: number;
  } | null;
  sources: Array<{
    tool: string;
    endpointPath: string;
    description: string;
  }>;
  verification: Array<{
    eventId: string;
    endpointPath: string;
    billedUsdcMicros: number;
    settlementWindowId: string | null;
    settlementStatus: string | null;
    proofUrl: string;
    explorerUrl: string | null;
  }>;
  markdown: string | null;
};

export type DemoRunListItem = {
  runId: string;
  prompt: string;
  targetAddress: string;
  status: string;
  riskLevel: "low" | "medium" | null;
  spentUsdcMicros: number;
  createdAt: string;
};

export type DemoBudgetView = {
  budgetId: string;
  ownerEmail: string;
  subscriptionId: string | null;
  apiKeyPreview: string | null;
  balanceUsdcMicros: number;
  refillAmountUsdcMicros: number;
  status: string;
  lastWebhookEvent: string | null;
  lastRefilledAt: string | null;
  updatedAt: string;
};

function formatUsd(usdcMicros: number) {
  return `$${(usdcMicros / 1_000_000).toFixed(2)}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderRunReportHtml(report: RunReportView) {
  const badgeTone =
    report.riskLevel === "medium"
      ? "background:#fff1cc;color:#8a5a00;border:1px solid #e9c46a;"
      : "background:#e9f7ef;color:#126b3e;border:1px solid #9dd4b3;";

  const findings = report.findings
    .map(
      (finding) =>
        `<li style="margin:0 0 10px 0;line-height:1.5;">${escapeHtml(finding)}</li>`
    )
    .join("");

  const sources = report.sources
    .map(
      (source) => `
        <li style="margin:0 0 12px 0;line-height:1.5;">
          <strong>${escapeHtml(source.tool)}</strong>
          <span style="color:#6b7280;">via ${escapeHtml(source.endpointPath)}</span><br />
          <span>${escapeHtml(source.description)}</span>
        </li>
      `
    )
    .join("");

  const markdown = report.markdown ? escapeHtml(report.markdown) : "No markdown available.";
  const verification = report.verification
    .map(
      (item) => `
        <li style="margin:0 0 14px 0;line-height:1.6;">
          <strong>${escapeHtml(item.endpointPath)}</strong>
          <span style="color:#6b7280;"> · ${formatUsd(item.billedUsdcMicros)}</span><br />
          <span style="color:#4b5563;">Event ${escapeHtml(item.eventId)}</span><br />
          <a href="${escapeHtml(item.proofUrl)}" style="color:#0f766e;font-weight:600;">Open proof JSON</a>
          ${
            item.explorerUrl
              ? ` · <a href="${escapeHtml(item.explorerUrl)}" style="color:#155e75;font-weight:600;">View Solana tx</a>`
              : ""
          }
          <br />
          <span style="color:#6b7280;">Window: ${escapeHtml(item.settlementWindowId ?? "pending")} · Status: ${escapeHtml(item.settlementStatus ?? "unassigned")}</span>
        </li>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.headline ?? "Agent Run Report")}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f1e8;
        --panel: #fffdf9;
        --ink: #1f2937;
        --muted: #6b7280;
        --line: #e5ded2;
        --accent: #0f766e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Avenir Next", system-ui, sans-serif;
        background:
          radial-gradient(circle at top right, rgba(15, 118, 110, 0.10), transparent 28%),
          linear-gradient(180deg, #faf6ef 0%, var(--bg) 100%);
        color: var(--ink);
      }
      .wrap {
        max-width: 1100px;
        margin: 0 auto;
        padding: 40px 20px 80px;
      }
      .hero, .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.06);
      }
      .hero {
        padding: 28px;
        margin-bottom: 20px;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 14px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(30px, 5vw, 52px);
        line-height: 1.05;
      }
      .sub {
        font-size: 18px;
        line-height: 1.6;
        max-width: 760px;
        color: #314155;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 22px;
      }
      .chip {
        padding: 9px 12px;
        border-radius: 999px;
        font-size: 13px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 20px;
      }
      .stat {
        padding: 18px;
      }
      .stat-label {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 10px;
      }
      .stat-value {
        font-size: 28px;
        font-weight: 700;
      }
      .two-up {
        display: grid;
        grid-template-columns: 1.25fr 0.9fr;
        gap: 20px;
        margin-bottom: 20px;
      }
      .panel {
        padding: 22px;
      }
      h2 {
        margin: 0 0 16px;
        font-size: 20px;
      }
      .muted {
        color: var(--muted);
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #fbf8f2;
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 18px;
        font-size: 13px;
        line-height: 1.55;
        overflow: auto;
      }
      @media (max-width: 920px) {
        .grid, .two-up {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <div class="eyebrow">Agent Budget Billing / Run Report</div>
        <h1>${escapeHtml(report.headline ?? "Agent run report")}</h1>
        <div class="sub">${escapeHtml(report.executiveSummary ?? "No executive summary available.")}</div>
        <div class="meta">
          <span class="chip" style="${badgeTone}">Risk: ${escapeHtml(report.riskLevel ?? "unknown")}</span>
          <span class="chip" style="background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;">Run ${escapeHtml(report.runId)}</span>
          <span class="chip" style="background:#ecfeff;color:#155e75;border:1px solid #a5f3fc;">Status: ${escapeHtml(report.status)}</span>
        </div>
      </section>

      <section class="grid">
        <div class="panel stat">
          <div class="stat-label">Allocated</div>
          <div class="stat-value">${report.spendSummary ? formatUsd(report.spendSummary.allocatedUsdcMicros) : "-"}</div>
        </div>
        <div class="panel stat">
          <div class="stat-label">Spent</div>
          <div class="stat-value">${report.spendSummary ? formatUsd(report.spendSummary.spentUsdcMicros) : "-"}</div>
        </div>
        <div class="panel stat">
          <div class="stat-label">Remaining</div>
          <div class="stat-value">${report.spendSummary ? formatUsd(report.spendSummary.remainingUsdcMicros) : "-"}</div>
        </div>
        <div class="panel stat">
          <div class="stat-label">Paid Tool Calls</div>
          <div class="stat-value">${report.spendSummary?.paidToolCalls ?? 0}</div>
        </div>
      </section>

      <section class="two-up">
        <div class="panel">
          <h2>Findings</h2>
          <ul style="padding-left:20px;margin:0;">${findings}</ul>
        </div>
        <div class="panel">
          <h2>Recommendation</h2>
          <p style="margin:0;line-height:1.7;">${escapeHtml(report.recommendation ?? "No recommendation available.")}</p>
        </div>
      </section>

      <section class="two-up">
        <div class="panel">
          <h2>Sources</h2>
          <ul style="padding-left:20px;margin:0;">${sources}</ul>
        </div>
        <div class="panel">
          <h2>Presenter Markdown</h2>
          <div class="muted" style="margin-bottom:12px;">Useful if you want to paste the run into notes or a tweet-sized demo script.</div>
          <pre>${markdown}</pre>
        </div>
      </section>

      <section class="two-up">
        <div class="panel">
          <h2>Verification</h2>
          <div class="muted" style="margin-bottom:12px;">These are the billed usage events for this run. Each one can be traced to a settlement window and a proof payload.</div>
          <ul style="padding-left:20px;margin:0;">${verification || `<li style="line-height:1.6;color:#6b7280;">No verification events available.</li>`}</ul>
        </div>
        <div class="panel">
          <h2>Why It Matters</h2>
          <p style="margin:0;line-height:1.8;color:#334155;">
            The gateway meters paid calls off-chain for speed, then anchors short settlement windows on Solana.
            The proof links above connect an individual billed event to that committed batch.
          </p>
        </div>
      </section>
    </div>
  </body>
</html>`;
}

export function renderDemoHomeHtml(input: {
  runs: DemoRunListItem[];
  budgets: DemoBudgetView[];
  defaultApiKey: string;
  defaultTargetAddress: string;
  defaultTopUpUsdCents: number;
}) {
  const budgetCards = input.budgets
    .map((budget) => {
      const statusTone =
        budget.status === "active"
          ? "background:#e9f7ef;color:#126b3e;"
          : budget.status === "exhausted"
            ? "background:#fff1cc;color:#8a5a00;"
            : "background:#f3f4f6;color:#374151;";

      return `
        <article style="padding:18px;border:1px solid #e5ded2;border-radius:18px;background:#fffdf9;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">
            <div>
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">${budget.subscriptionId ? "Dodo subscription budget" : "Local dev budget"}</div>
              <div style="font-size:18px;font-weight:700;line-height:1.35;margin-bottom:8px;">${escapeHtml(budget.ownerEmail)}</div>
              <div style="color:#4b5563;line-height:1.5;">${escapeHtml(
                budget.subscriptionId ?? budget.budgetId
              )}</div>
            </div>
            <span style="padding:8px 10px;border-radius:999px;font-size:12px;${statusTone}">${escapeHtml(
              budget.status
            )}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px;">
            <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #dbe4ee;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:6px;">Balance</div>
              <div style="font-size:22px;font-weight:700;">${formatUsd(budget.balanceUsdcMicros)}</div>
            </div>
            <div style="padding:12px 14px;border-radius:14px;background:#f8fafc;border:1px solid #dbe4ee;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:6px;">Refill amount</div>
              <div style="font-size:22px;font-weight:700;">${formatUsd(budget.refillAmountUsdcMicros)}</div>
            </div>
          </div>
          <div style="color:#6b7280;font-size:14px;line-height:1.6;">
            <div>Last event: ${escapeHtml(budget.lastWebhookEvent ?? "none")}</div>
            <div>Last refilled: ${escapeHtml(budget.lastRefilledAt ?? "never")}</div>
            <div>API key: ${escapeHtml(budget.apiKeyPreview ?? "hidden")}</div>
          </div>
        </article>
      `;
    })
    .join("");

  const runCards = input.runs
    .map((run) => {
      const riskTone =
        run.riskLevel === "medium"
          ? "background:#fff1cc;color:#8a5a00;"
          : "background:#e9f7ef;color:#126b3e;";

      return `
        <article style="padding:18px;border:1px solid #e5ded2;border-radius:18px;background:#fffdf9;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
            <div>
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Run ${escapeHtml(run.runId)}</div>
              <div style="font-size:18px;font-weight:700;line-height:1.35;margin-bottom:8px;">${escapeHtml(run.prompt)}</div>
              <div style="color:#4b5563;line-height:1.5;">Target: ${escapeHtml(run.targetAddress)}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <span style="padding:8px 10px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:12px;">${escapeHtml(run.status)}</span>
              <span style="padding:8px 10px;border-radius:999px;font-size:12px;${riskTone}">risk: ${escapeHtml(run.riskLevel ?? "n/a")}</span>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-top:16px;">
            <div style="color:#6b7280;font-size:14px;">Spent ${formatUsd(run.spentUsdcMicros)} · ${escapeHtml(run.createdAt)}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <a href="/demo/runs/${escapeHtml(run.runId)}" style="text-decoration:none;padding:10px 14px;border-radius:12px;background:#0f766e;color:white;font-weight:600;">Open report</a>
              <a href="/api/runs/${escapeHtml(run.runId)}/report" style="text-decoration:none;padding:10px 14px;border-radius:12px;background:#ecfeff;color:#155e75;font-weight:600;">View JSON</a>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Budget Billing Demo</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffdf9;
        --ink: #1f2937;
        --muted: #6b7280;
        --line: #e5ded2;
        --accent: #0f766e;
        --accent-2: #c2410c;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Avenir Next", system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(194, 65, 12, 0.10), transparent 24%),
          radial-gradient(circle at right top, rgba(15, 118, 110, 0.10), transparent 28%),
          linear-gradient(180deg, #fbf7f1 0%, var(--bg) 100%);
        color: var(--ink);
      }
      .wrap {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 20px 80px;
      }
      .hero, .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.06);
      }
      .hero {
        padding: 28px;
        margin-bottom: 22px;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 14px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(32px, 5vw, 56px);
        line-height: 1.04;
      }
      .sub {
        max-width: 820px;
        font-size: 18px;
        line-height: 1.65;
        color: #334155;
      }
      .layout {
        display: grid;
        grid-template-columns: 0.95fr 1.2fr;
        gap: 20px;
        align-items: start;
      }
      .stack {
        display: grid;
        gap: 20px;
      }
      .panel {
        padding: 22px;
      }
      h2 {
        margin: 0 0 16px;
        font-size: 22px;
      }
      label {
        display: block;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 8px;
      }
      input, textarea {
        width: 100%;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: #fff;
        font: inherit;
      }
      textarea {
        min-height: 124px;
        resize: vertical;
      }
      .field {
        margin-bottom: 16px;
      }
      button {
        border: 0;
        border-radius: 14px;
        background: var(--accent);
        color: white;
        font: inherit;
        font-weight: 700;
        padding: 14px 18px;
        cursor: pointer;
      }
      .hint {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
      }
      .result {
        margin-top: 16px;
        padding: 14px 16px;
        border-radius: 14px;
        background: #f8fafc;
        border: 1px solid #dbe4ee;
        display: none;
      }
      .result.show {
        display: block;
      }
      .runs {
        display: grid;
        gap: 14px;
      }
      .budgets {
        display: grid;
        gap: 14px;
      }
      @media (max-width: 980px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <div class="eyebrow">Dodo + Solana / Agent Budget Billing</div>
        <h1>Run a funded Solana screening agent.</h1>
        <div class="sub">
          This local demo lets a human owner simulate a Dodo subscription renewal event,
          launch a wallet-screening run, and inspect exactly how many paid tool calls the agent used before returning a report.
        </div>
      </section>

      <section class="layout">
        <div class="stack">
          <div class="panel">
            <h2>Dodo Budget Lifecycle</h2>
            <p class="hint" style="margin-top:0;">
              This panel keeps the sponsor story on screen: subscription-backed budgets, refill amount,
              latest Dodo event, and the current spendable balance used by the agent.
            </p>
            <form id="dodo-top-up-form" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:16px;">
              <div class="field" style="margin:0;min-width:180px;flex:1;">
                <label for="topUpUsdCents">Top-up amount (USD cents)</label>
                <input id="topUpUsdCents" name="topUpUsdCents" type="number" min="100" step="100" value="${escapeHtml(
                  String(input.defaultTopUpUsdCents)
                )}" />
              </div>
              <button type="submit" style="background:#c2410c;">Simulate renewal event</button>
            </form>
            <div class="result" id="dodo-result"></div>
            <div class="budgets">
              ${budgetCards || `<div class="hint">No budgets available yet.</div>`}
            </div>
          </div>

          <div class="panel">
            <h2>Launch a Run</h2>
            <form id="run-form">
              <div class="field">
                <label for="apiKey">API Key</label>
                <input id="apiKey" name="apiKey" value="${escapeHtml(input.defaultApiKey)}" />
              </div>
              <div class="field">
                <label for="targetAddress">Target Wallet</label>
                <input id="targetAddress" name="targetAddress" value="${escapeHtml(input.defaultTargetAddress)}" />
              </div>
              <div class="field">
                <label for="prompt">Prompt</label>
                <textarea id="prompt" name="prompt">Screen this wallet before treasury sends funds and give me the brief.</textarea>
              </div>
              <button type="submit">Run funded agent</button>
            </form>
            <div class="result" id="result"></div>
            <p class="hint">
              Current planner v0 performs 5 paid tool calls: wallet summary, recent activity, holder distribution, risk flags, and LLM analysis.
            </p>
          </div>
        </div>

        <div class="panel">
          <h2>Recent Runs</h2>
          <div class="runs">
            ${runCards || `<div class="hint">No runs yet. Launch one from the form.</div>`}
          </div>
        </div>
      </section>
    </div>
    <script>
      const form = document.getElementById("run-form");
      const result = document.getElementById("result");
      const dodoTopUpForm = document.getElementById("dodo-top-up-form");
      const dodoResult = document.getElementById("dodo-result");

      dodoTopUpForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const amountUsdCents = Number(document.getElementById("topUpUsdCents").value);

        dodoResult.className = "result show";
        dodoResult.innerHTML = "Simulating Dodo renewal event...";

        try {
          const response = await fetch("/demo/dodo/simulate-renewal", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              amountUsdCents,
            }),
          });

          const payload = await response.json();

          if (!response.ok) {
            dodoResult.innerHTML = "<strong>Top-up failed:</strong> " + (payload.error || response.statusText);
            return;
          }

          dodoResult.innerHTML = [
            "<strong>Dodo renewal event applied.</strong>",
            "<br />",
            "Subscription: <code>" + payload.subscriptionId + "</code>",
            "<br />",
            "New balance: <strong>$" + (payload.balanceUsdcMicros / 1000000).toFixed(2) + "</strong>",
            "<br />",
            "Refill amount: <strong>$" + (payload.refillAmountUsdcMicros / 1000000).toFixed(2) + "</strong>",
            "<br /><br />Refreshing budget cards..."
          ].join("");

          setTimeout(() => window.location.reload(), 900);
        } catch (error) {
          dodoResult.innerHTML = "<strong>Unexpected error:</strong> " + error.message;
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const apiKey = document.getElementById("apiKey").value;
        const targetAddress = document.getElementById("targetAddress").value;
        const prompt = document.getElementById("prompt").value;

        result.className = "result show";
        result.innerHTML = "Running agent...";

        try {
          const response = await fetch("/api/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify({
              prompt,
              targetAddress,
              publisherSlug: "wallet-summary",
              cluster: "devnet",
            }),
          });

          const payload = await response.json();

          if (!response.ok) {
            result.innerHTML = "<strong>Run failed:</strong> " + (payload.error || response.statusText);
            return;
          }

          const runId = payload.run.runId;
          result.innerHTML = [
            "<strong>Run created successfully.</strong>",
            "<br />",
            "Run ID: <code>" + runId + "</code>",
            "<br />",
            '<a href="/demo/runs/' + runId + '">Open HTML report</a>',
            " · ",
            '<a href="/api/runs/' + runId + '/report">Open JSON report</a>',
            "<br /><br />Refresh the page to see the run in the recent runs list."
          ].join("");
        } catch (error) {
          result.innerHTML = "<strong>Unexpected error:</strong> " + error.message;
        }
      });
    </script>
  </body>
</html>`;
}
