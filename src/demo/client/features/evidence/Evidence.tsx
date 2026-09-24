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
    <Tabs defaultValue="matrix" className="w-full">
      <TabsList>
        <TabsTrigger value="matrix">Failure breakdown</TabsTrigger>
        <TabsTrigger value="trials">Trials {trials.length}</TabsTrigger>
        <TabsTrigger value="evals">Evaluations {evaluations.length}</TabsTrigger>
        <TabsTrigger value="gaps">GAPS</TabsTrigger>
      </TabsList>

      <TabsContent value="matrix" className="flex flex-col gap-4 pt-3">
        <FailureMatrix rows={trials} onPick={setPicked} />
        {picked && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">{picked.length} selected trials</h4>
            <TrialTable rows={picked} />
          </div>
        )}
      </TabsContent>

      <TabsContent value="trials" className="pt-3">
        <TrialTable rows={trials} />
      </TabsContent>

      <TabsContent value="evals" className="pt-3">
        <EvaluationTable rows={evaluations} />
      </TabsContent>

      <TabsContent value="gaps" className="pt-3">
        {gaps ? (
          <ScrollArea className="max-h-[50vh] border border-border bg-card">
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
