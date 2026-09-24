/**
 * The task's definition, read straight off disk.
 *
 * A recommendation is only as good as the spec that produced it, so the files
 * are shown verbatim rather than summarised — the spec, the rubric, the
 * checks and the inputs are the claim, and a reader should be able to check
 * it without leaving the page.
 */

import { useEffect, useState } from "react";
import { getText, taskFileUrl } from "@/lib/api";
import { defaultFile } from "@/lib/format";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function useFileText(task: string, rel: string | undefined): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!rel) {
      setText("");
      return;
    }
    let live = true;
    setText("载入中…");
    getText(taskFileUrl(task, rel))
      .then((t) => live && setText(t))
      .catch((e: unknown) => {
        if (live) setText(`读不到 ${rel} —— ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      live = false;
    };
  }, [task, rel]);
  return text;
}

export function FileBrowser({ task, files }: { task: string; files: readonly string[] }) {
  const [selected, setSelected] = useState<string | undefined>(() => defaultFile(files));
  useEffect(() => setSelected(defaultFile(files)), [task, files]);
  const text = useFileText(task, selected);

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(180px,240px)_1fr]">
      <ScrollArea className="max-h-[60vh] border border-border">
        <ul className="flex flex-col gap-0.5 p-1">
          {files.map((file) => (
            <li key={file}>
              <button
                type="button"
                onClick={() => setSelected(file)}
                aria-current={file === selected ? "true" : undefined}
                className={cn(
                  "w-full  border border-transparent px-2 py-1.5 text-left font-mono text-xs",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  "aria-[current]:border-border aria-[current]:bg-accent",
                )}
              >
                {file}
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <ScrollArea className="max-h-[60vh] border border-border bg-card">
        <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </pre>
      </ScrollArea>
    </div>
  );
}
