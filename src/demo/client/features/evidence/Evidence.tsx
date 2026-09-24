/** A run's evidence: the failure matrix first, then the rows behind it. */

import { useEffect, useState } from "react";
import type { RunView } from "../../../catalog.js";
import { readJsonl, readText, type EvaluationRow, type TrialRow } from "./model";
import { FailureMatrix } from "./FailureMatrix";
import { TrialTable } from "./TrialTable";
import { EvaluationTable } from "./EvaluationTable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { CARD_TAB, CARD_TAB_ROW, SECTION_CARD } from "@/components/section-style";
import { cn } from "@/lib/utils";

function Count({ n }: { n: number }) {
  return <span className="text-xs font-normal text-muted-foreground">{n}</span>;
}

interface EvidenceFiles {
  trials: TrialRow[];
  evaluations: EvaluationRow[];
  gaps: string;
}

const EMPTY: EvidenceFiles = { trials: [], evaluations: [], gaps: "" };

function useEvidence(run: RunView): EvidenceFiles {
  const [files, setFiles] = useState<EvidenceFiles>(EMPTY);
  useEffect(() => {
    let live = true;
    setFiles(EMPTY);
    void Promise.all([
      readJsonl<TrialRow>(run, "scores.jsonl"),
      readJsonl<EvaluationRow>(run, "evaluations.jsonl"),
      readText(run, "GAPS.md"),
    ]).then(([trials, evaluations, gaps]) => live && setFiles({ trials, evaluations, gaps }));
    return () => {
      live = false;
    };
  }, [run]);
  return files;
}

export function Evidence({ run }: { run: RunView }) {
  const { trials, evaluations, gaps } = useEvidence(run);
  const [picked, setPicked] = useState<TrialRow[] | null>(null);
  useEffect(() => setPicked(null), [run]);

  return (
    <Tabs defaultValue="matrix" className={cn(SECTION_CARD, "w-full gap-0 overflow-hidden border border-border bg-card")}>
      <TabsList variant="line" className={CARD_TAB_ROW}>
        <TabsTrigger value="matrix" className={CARD_TAB}>Failure breakdown</TabsTrigger>
        <TabsTrigger value="trials" className={CARD_TAB}>Trials <Count n={trials.length} /></TabsTrigger>
        <TabsTrigger value="evals" className={CARD_TAB}>Evaluations <Count n={evaluations.length} /></TabsTrigger>
        <TabsTrigger value="gaps" className={CARD_TAB}>GAPS</TabsTrigger>
      </TabsList>

      <TabsContent value="matrix" className="flex flex-col gap-4 p-4">
        <FailureMatrix rows={trials} onPick={setPicked} />
        {picked && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">{picked.length} selected trials</h4>
            <TrialTable rows={picked} />
          </div>
        )}
      </TabsContent>

      <TabsContent value="trials" className="p-4">
        <TrialTable rows={trials} />
      </TabsContent>

      <TabsContent value="evals" className="p-4">
        <EvaluationTable rows={evaluations} />
      </TabsContent>

      <TabsContent value="gaps" className="p-4">
        {gaps ? (
          <ScrollArea className="max-h-[50vh] border border-border bg-background">
            <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {gaps}
            </pre>
          </ScrollArea>
        ) : (
          <Empty>
            <EmptyHeader><EmptyTitle>This run has no GAPS.md</EmptyTitle></EmptyHeader>
          </Empty>
        )}
      </TabsContent>
    </Tabs>
  );
}
