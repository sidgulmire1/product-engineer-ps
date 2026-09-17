import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleSlash,
  FileSearch,
  HeartPulse,
  Loader2,
  ShieldQuestion,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  runInvestigation,
  TOOL_MANIFEST,
  type InvestigationRun,
  type TraceStep,
} from "@/lib/investigate.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Incident Investigator — Autonomous Root Cause Analysis" },
      {
        name: "description",
        content:
          "Give the agent an incident objective and watch it query logs, metrics and service status step by step, then report evidence and a root cause.",
      },
      { property: "og:title", content: "AI Incident Investigator" },
      {
        property: "og:description",
        content:
          "An autonomous SRE agent that investigates production incidents with a fully visible execution trace.",
      },
    ],
  }),
  component: InvestigatorPage,
});

const TOOL_ICONS: Record<string, typeof FileSearch> = {
  search_logs: FileSearch,
  get_metrics: BarChart3,
  get_service_status: HeartPulse,
};

const EXAMPLES = [
  "Investigate why the payment service is experiencing failures.",
  "Checkout conversion dropped 40% in the last hour — find out why.",
  "Is the ledger database responsible for slow payments?",
];

function InvestigatorPage() {
  const [objective, setObjective] = useState<string>(EXAMPLES[0] ?? "");
  const investigate = useServerFn(runInvestigation);

  const mutation = useMutation<InvestigationRun, Error, string>({
    mutationFn: (value) => investigate({ data: { objective: value } }),
  });

  const run = mutation.data;
  const isRunning = mutation.isPending;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 md:py-14">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 mono text-xs uppercase tracking-[0.22em] text-primary">
          <Terminal className="size-4" />
          incident agent · v1
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          AI Incident Investigator
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          State an objective. The agent decides which observability tool to call, its calls are
          validated before execution, and every result is recorded as evidence until it can name a
          root cause.
        </p>
      </header>

      <section className="mt-8 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <form
          className="rounded-lg border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (objective.trim().length > 3) mutation.mutate(objective.trim());
          }}
        >
          <label className="mono text-[11px] uppercase tracking-widest text-muted-foreground">
            objective
          </label>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={3}
            disabled={isRunning}
            className="mt-2 w-full resize-none rounded-md border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            placeholder="Investigate why the payment service is experiencing failures."
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isRunning || objective.trim().length < 4}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isRunning ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {isRunning ? "Investigating…" : "Start investigation"}
            </button>
            {EXAMPLES.slice(1).map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={isRunning}
                onClick={() => setObjective(ex)}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {(ex.split("—")[0] ?? ex).trim().slice(0, 34)}…
              </button>
            ))}
          </div>
          <RunStatus run={run} isRunning={isRunning} error={mutation.error} />
        </form>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mono text-[11px] uppercase tracking-widest text-muted-foreground">
            available tools
          </h2>
          <ul className="mt-3 space-y-3">
            {TOOL_MANIFEST.map((tool) => {
              const Icon = TOOL_ICONS[tool.name] ?? Wrench;
              return (
                <li key={tool.name} className="flex gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-signal">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <p className="mono text-sm text-foreground">{tool.name}</p>
                    <p className="text-xs text-muted-foreground">{tool.description}</p>
                    <p className="mono mt-1 text-[11px] text-signal">({tool.args})</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {isRunning && !run && <RunningSkeleton />}

      {run && (
        <>
          <ExecutionTrace steps={run.steps} />
          <TerminationNotice run={run} />
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <EvidencePanel run={run} />
            <ConclusionPanel run={run} />
          </div>
        </>
      )}
    </main>
  );
}

function RunStatus({
  run,
  isRunning,
  error,
}: {
  run?: InvestigationRun | undefined;
  isRunning: boolean;
  error: Error | null;
}) {
  const state = isRunning
    ? { label: "running", tone: "text-primary", Icon: Loader2, spin: true }
    : error || run?.status === "failed"
      ? { label: "failed", tone: "text-destructive", Icon: XCircle, spin: false }
      : run?.status === "limit_reached"
        ? { label: "limit reached", tone: "text-warn", Icon: CircleSlash, spin: false }
        : run
          ? { label: "resolved", tone: "text-signal", Icon: CheckCircle2, spin: false }
          : { label: "idle", tone: "text-muted-foreground", Icon: Activity, spin: false };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 mono text-xs">
      <span className={`inline-flex items-center gap-2 ${state.tone}`}>
        <state.Icon className={`size-3.5 ${state.spin ? "animate-spin" : ""}`} />
        status: {state.label}
      </span>
      <span className="text-muted-foreground">
        steps: {run ? `${run.stepsUsed}/${run.maxSteps}` : `0/6`}
      </span>
      <span className="text-muted-foreground">model: {run?.model ?? "nvidia/nemotron-3-ultra-550b-a55b"}</span>
      {(error || run?.error) && (
        <span className="text-destructive">{error?.message ?? run?.error}</span>
      )}
    </div>
  );
}

function RunningSkeleton() {
  return (
    <div className="mt-8 space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-card"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

function ExecutionTrace({ steps }: { steps: TraceStep[] }) {
  return (
    <section className="mt-9">
      <h2 className="mono text-[11px] uppercase tracking-widest text-muted-foreground">
        execution trace
      </h2>
      <ol className="mt-4 space-y-3">
        {steps.map((step) => (
          <StepCard key={step.index} step={step} />
        ))}
      </ol>
    </section>
  );
}

function StepCard({ step }: { step: TraceStep }) {
  const [open, setOpen] = useState(false);
  const Icon = step.tool ? (TOOL_ICONS[step.tool] ?? Wrench) : CheckCircle2;
  const failed = Boolean(step.error);

  return (
    <li className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="mono grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-xs text-muted-foreground">
          {step.index}
        </span>
        <span
          className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md ${
            failed ? "bg-destructive/15 text-destructive" : "bg-secondary text-signal"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="mono text-sm text-foreground">
              {step.tool ?? "final decision"}
            </span>
            {failed ? (
              <span className="mono rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
                {step.errorKind === "validation" ? "validation error" : "tool error"}
              </span>
            ) : step.tool ? (
              <span className="mono rounded bg-signal/15 px-1.5 py-0.5 text-[10px] uppercase text-signal">
                ok
              </span>
            ) : null}
            <span className="mono text-[11px] text-muted-foreground">{step.durationMs}ms</span>
          </span>
          {step.decisionSummary && (
            <span className="mt-1 block text-sm text-muted-foreground">{step.decisionSummary}</span>
          )}
        </span>
      </button>

      {(step.input || step.output || step.error) && (
        <div className="border-t border-border px-4 py-3">
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              show input / output
            </button>
          ) : (
            <div className="space-y-3">
              {step.input && (
                <Block label="input" value={prettify(step.input)} />
              )}
              {step.output && <Block label="output" value={step.output} />}
              {step.error && <Block label="error" value={step.error} tone="destructive" />}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                hide
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Block({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive";
}) {
  return (
    <div>
      <p
        className={`mono text-[10px] uppercase tracking-widest ${
          tone === "destructive" ? "text-destructive" : "text-signal"
        }`}
      >
        {label}
      </p>
      <pre
        className={`mono mt-1 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs whitespace-pre-wrap ${
          tone === "destructive" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </pre>
    </div>
  );
}

function prettify(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function TerminationNotice({ run }: { run: InvestigationRun }) {
  if (!run.terminationReason) return null;
  const limited = run.status === "limit_reached";
  return (
    <div
      className={`mt-4 flex items-start gap-3 rounded-lg border p-4 text-sm ${
        limited
          ? "border-warn/40 bg-warn/10 text-warn"
          : run.status === "failed"
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-border bg-card text-muted-foreground"
      }`}
    >
      {limited ? (
        <CircleSlash className="mt-0.5 size-4 shrink-0" />
      ) : run.status === "failed" ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-signal" />
      )}
      <p>{run.terminationReason}</p>
    </div>
  );
}

function EvidencePanel({ run }: { run: InvestigationRun }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mono text-[11px] uppercase tracking-widest text-muted-foreground">
        evidence ({run.evidence.length})
      </h2>
      <ul className="mt-3 space-y-3">
        {run.evidence.length === 0 && (
          <li className="text-sm text-muted-foreground">No evidence was recorded.</li>
        )}
        {run.evidence.map((item, i) => (
          <li key={i} className="border-l-2 border-signal/60 pl-3">
            <p className="text-sm text-foreground">{item.finding}</p>
            <p className="mono mt-1 text-[11px] text-signal">{item.source}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConclusionPanel({ run }: { run: InvestigationRun }) {
  const c = run.conclusion;
  return (
    <section className="rounded-lg border border-primary/30 bg-card p-4">
      <h2 className="mono text-[11px] uppercase tracking-widest text-primary">conclusion</h2>
      {!c ? (
        <p className="mt-3 text-sm text-muted-foreground">
          The run ended before a conclusion could be formed.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-sm leading-relaxed text-foreground">{c.rootCause}</p>
          <p className="mono text-[11px] text-muted-foreground">confidence: {c.confidence}</p>
          {c.remediation.length > 0 && (
            <div>
              <p className="mono text-[10px] uppercase tracking-widest text-signal">remediation</p>
              <ul className="mt-2 space-y-1.5">
                {c.remediation.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground">
                    <Wrench className="mt-0.5 size-3.5 shrink-0 text-signal" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.unknowns.length > 0 && (
            <div>
              <p className="mono text-[10px] uppercase tracking-widest text-warn">open unknowns</p>
              <ul className="mt-2 space-y-1.5">
                {c.unknowns.map((u, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <ShieldQuestion className="mt-0.5 size-3.5 shrink-0 text-warn" />
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
