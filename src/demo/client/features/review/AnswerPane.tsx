/**
 * One side of a pair: the files the spec's `show` globs picked, one tab each.
 *
 * Candidate output is untrusted, so everything renders as text — JSON is
 * re-indented for reading, nothing is ever parsed into markup.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ShownFile {
  path: string;
  content: string;
  truncated: boolean;
}

function readable(file: ShownFile): string {
  if (!file.path.endsWith(".json") || file.truncated) return file.content;
  try {
    return JSON.stringify(JSON.parse(file.content), null, 2);
  } catch {
    return file.content;
  }
}

export function AnswerPane({ label, files, revealedAs }: { label: string; files: ShownFile[]; revealedAs?: string }) {
  const [active, setActive] = useState(0);
  const file = files[Math.min(active, files.length - 1)];
  return (
    <div className="flex min-w-0 flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm font-semibold">{label}</span>
        {revealedAs && <span className="font-mono text-xs text-brand">{revealedAs}</span>}
      </div>
      {files.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">This answer left none of the files under review.</p>
      ) : (
        <>
          {files.length > 1 && (
            <div className="flex flex-wrap gap-1 border-b px-2 py-1.5">
              {files.map((f, i) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setActive(i)}
                  className={cn("rounded px-2 py-0.5 font-mono text-xs", i === active ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/60")}
                >
                  {f.path}
                </button>
              ))}
            </div>
          )}
          {files.length === 1 && <div className="border-b px-3 py-1 font-mono text-xs text-muted-foreground">{file.path}</div>}
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">{readable(file)}</pre>
          {file.truncated && <p className="border-t px-3 py-1.5 text-xs text-warn">Truncated for review: the file is larger than shown.</p>}
        </>
      )}
    </div>
  );
}
