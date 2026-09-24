/**
 * A small label in one of the dashboard's meaning colours.
 *
 * shadcn's badge variants are about emphasis (solid, muted, outlined), not
 * meaning, so "failed" and "needs review" drew the same red and "passed"
 * drew the same black as every other primary element. A Tag says which of
 * success / warning / failure a state is, in the same colours report.html
 * uses; `lib/tone.ts` decides which tone a protocol state gets.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TagTone = "ok" | "warn" | "bad" | "brand" | "neutral";

const TAG: Record<TagTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-muted text-muted-foreground",
};

interface TagProps {
  tone: TagTone;
  className?: string;
  children: ReactNode;
}

export function Tag({ tone, className, children }: TagProps) {
  return (
    <span className={cn("inline-flex h-5 w-fit items-center px-2 text-xs font-semibold whitespace-nowrap", TAG[tone], className)}>
      {children}
    </span>
  );
}
