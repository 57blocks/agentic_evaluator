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
import { SECTION_CARD } from "@/components/section-style";
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
    setText("Loading…");
    getText(taskFileUrl(task, rel))
      .then((t) => live && setText(t))
      .catch((e: unknown) => {
        if (live) setText(`Cannot read ${rel} — ${e instanceof Error ? e.message : String(e)}`);
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
      <ScrollArea className={cn(SECTION_CARD, "max-h-[60vh] overflow-hidden border border-border bg-card")}>
        <ul className="flex flex-col gap-0.5 p-1.5">
          {files.map((file) => (
            <li key={file}>
              <button
                type="button"
                onClick={() => setSelected(file)}
                aria-current={file === selected ? "true" : undefined}
                className={cn(
                  "w-full rounded-md px-2.5 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors",
                  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none",
                  "aria-[current]:bg-brand-soft aria-[current]:font-semibold aria-[current]:text-brand",
                )}
              >
                {file}
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <ScrollArea className={cn(SECTION_CARD, "max-h-[60vh] overflow-hidden border border-border bg-card")}>
        <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </pre>
      </ScrollArea>
    </div>
  );
}
