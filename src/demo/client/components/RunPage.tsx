/** A single run: what each step recommended, who was gated and why. */

import type { RunView } from "../../catalog.js";
import { firmTone } from "../render.js";
import { Evidence } from "./Evidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function RunPage({ run }: { run: RunView }) {
  const firstReport = run.steps.find((s) => s.reportHref)?.reportHref;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{run.runName}</h2>
        <p className="text-[13px] text-muted-foreground">
          {run.id} · {run.kind === "workflow" ? "多步骤" : "单步骤"}
          {run.handoff ? " · 有交接" : " · 无交接"}
          {run.sample && " · 仓库样例"}
        </p>
        {run.e2e && (
          <p className="text-xs text-muted-foreground">
            单模型端到端对照 <b className="font-mono">{run.e2e.candidate}</b> ·{" "}
            {run.e2e.chain.join(" → ")} · 成功 {run.e2e.success} / 失败 {run.e2e.failure} / 未定{" "}
            {run.e2e.undetermined}
          </p>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {run.steps.map((step) => {
          const off = step.gated.map((g) => g.candidate);
          return (
            <Card key={step.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>{step.id}</span>
                  <Badge variant={firmTone(step.firmness)}>{step.firmness}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-[13px]">
                  {step.chosen ? (
                    <>推荐 <b className="font-mono">{step.chosen}</b></>
                  ) : (
                    "无人合格"
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[...step.eligible, ...off].map((c) => (
                    <Badge
                      key={c}
                      variant="secondary"
                      className={cn("font-mono", off.includes(c) && "line-through opacity-55")}
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
                {step.gated.length > 0 && (
                  <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-xs text-muted-foreground">
                    {step.gated.map((g) => (
                      <li key={g.candidate}>
                        <span className="font-mono">{g.candidate}</span> — {g.reason}
                      </li>
                    ))}
                  </ol>
                )}
                <p className="text-xs text-muted-foreground">
                  {step.operatingMode}
                  {step.ledgerTotal != null && ` · $${step.ledgerTotal.toFixed(4)}`}
                </p>
                {step.reportHref && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    render={<a href={step.reportHref} target="report" />}
                  >
                    打开本步报告
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">证据</h3>
        <Evidence run={run} />
      </section>

      {firstReport && (
        <iframe
          title="步骤报告"
          src={firstReport}
          className="min-h-[70vh] w-full rounded-lg border border-border bg-card"
        />
      )}
    </div>
  );
}
