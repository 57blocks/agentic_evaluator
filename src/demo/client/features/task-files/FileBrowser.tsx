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
import type { DefinitionFiles, FileRole } from "../../../definition-files.js";
import { Tag } from "@/components/tag";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CARD_TAB, CARD_TAB_ROW, SECTION_CARD } from "@/components/section-style";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Highlight = (path: string, text: string) => string | null;

/**
 * The highlighter, loaded when a file viewer first mounts rather than with
 * the app: it is only needed on a task page. Until it arrives the file shows
 * as plain text, so nothing waits on it.
 */
function useHighlighter(): Highlight | null {
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  useEffect(() => {
    let live = true;
    import("@/lib/highlight")
      .then((m) => live && setHighlight(() => m.highlightFile))
      .catch(() => {
        // Colouring is a nicety: without it the file still reads as plain text.
      });
    return () => {
      live = false;
    };
  }, []);
  return highlight;
}

/** What the viewer shows: the file's text, or a message about why there is none. */
interface FileText {
  text: string;
  /** True only for the file's own content — never a loading or error message. */
  isContent: boolean;
}

function useFileText(task: string, rel: string | undefined): FileText {
  const [state, setState] = useState<FileText>({ text: "", isContent: false });
  useEffect(() => {
    if (!rel) {
      setState({ text: "", isContent: false });
      return;
    }
    let live = true;
    setState({ text: "Loading…", isContent: false });
    getText(taskFileUrl(task, rel))
      .then((t) => live && setState({ text: t, isContent: true }))
      .catch((e: unknown) => {
        if (live) setState({ text: `Cannot read ${rel} — ${e instanceof Error ? e.message : String(e)}`, isContent: false });
      });
    return () => {
      live = false;
    };
  }, [task, rel]);
  return state;
}

type ItemRole = FileRole | "spec" | "other";

interface Item {
  path: string;
  role: ItemRole;
}

interface Panel {
  key: string;
  label: string;
  items: Item[];
}

const ROLE_LABEL: Record<ItemRole, string> = {
  spec: "Spec",
  input: "Input",
  prompt: "Prompt",
  rubric: "Rubric",
  check: "Check",
  scaffold: "Scaffold",
  agent: "Agent",
  other: "Other",
};

const OVERVIEW = "__overview";

/**
 * A fixed height, so the card does not jump as you switch tabs or files —
 * each pane scrolls inside it. On a narrow screen the list sits above the
 * viewer and gets a shorter box of its own.
 */
const PANE_HEIGHT = "h-[32rem]";
const LIST_HEIGHT = "h-48 md:h-[32rem]";


/**
 * One tab per step when there is more than one; a single list otherwise,
 * because a tab bar with one tab is a click that shows nothing new. The
 * overview tab holds the spec and whatever no step references.
 */
function panelsOf(definition: DefinitionFiles, files: readonly string[]): Panel[] {
  const spec: Item[] = definition.spec ? [{ path: definition.spec, role: "spec" }] : [];
  const other: Item[] = definition.other.map((p) => ({ path: p, role: "other" }));
  const steps = definition.steps;
  if (steps.length === 0) return [{ key: OVERVIEW, label: "Files", items: files.map((p) => ({ path: p, role: "other" })) }];
  if (steps.length === 1) return [{ key: OVERVIEW, label: "Files", items: [...spec, ...steps[0].files, ...other] }];
  return [
    { key: OVERVIEW, label: "Overview", items: [...spec, ...other] },
    ...steps.map((st) => ({ key: st.id, label: st.id, items: st.files })),
  ];
}

function FileList({ items, selected, onSelect }: { items: Item[]; selected: string | undefined; onSelect: (p: string) => void }) {
  if (items.length === 0) return <p className="p-3 text-xs text-muted-foreground">This step references no file in the task.</p>;
  return (
    <ul className="flex flex-col gap-0.5 p-1.5">
      {items.map((item) => (
        <li key={`${item.role}:${item.path}`}>
          <button
            type="button"
            onClick={() => onSelect(item.path)}
            aria-current={item.path === selected ? "true" : undefined}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none",
              "aria-[current]:bg-brand-soft aria-[current]:font-semibold aria-[current]:text-brand",
            )}
          >
            <span className="min-w-0 truncate" title={item.path}>{item.path}</span>
            <Tag tone={item.role === "spec" ? "brand" : "neutral"} className="h-4 px-1.5 font-sans text-[10px] font-medium">
              {ROLE_LABEL[item.role]}
            </Tag>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface FileBrowserProps {
  task: string;
  files: readonly string[];
  definition: DefinitionFiles;
}

export function FileBrowser({ task, files, definition }: FileBrowserProps) {
  const panels = panelsOf(definition, files);
  const [active, setActive] = useState(panels[0].key);
  // Each tab remembers its own selection, starting on its first file.
  const [picked, setPicked] = useState<Record<string, string>>({});
  useEffect(() => {
    setActive(OVERVIEW);
    setPicked({});
  }, [task]);

  const panel = panels.find((p) => p.key === active) ?? panels[0];
  const selected = picked[panel.key] ?? panel.items[0]?.path;
  const file = useFileText(task, selected);
  const highlight = useHighlighter();
  // Only the file's own text is coloured; highlight.js escapes it, so it is safe as HTML.
  const html = highlight && file.isContent && selected ? highlight(selected, file.text) : null;
  const select = (p: string): void => setPicked((prev) => ({ ...prev, [panel.key]: p }));

  return (
    <div className={cn(SECTION_CARD, "overflow-hidden border border-border bg-card")}>
      {panels.length > 1 && (
        <Tabs value={panel.key} onValueChange={(v) => setActive(String(v))} className="gap-0">
          <TabsList variant="line" className={CARD_TAB_ROW}>
            {panels.map((p) => (
              <TabsTrigger key={p.key} value={p.key} className={cn(CARD_TAB, p.key !== OVERVIEW && "font-mono")}>
                {p.label}
                <span className="text-xs font-normal text-muted-foreground">{p.items.length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="grid md:grid-cols-[minmax(220px,300px)_1fr]">
        <ScrollArea className={cn(LIST_HEIGHT, "border-b border-border md:border-r md:border-b-0")}>
          <FileList items={panel.items} selected={selected} onSelect={select} />
        </ScrollArea>
        <ScrollArea className={PANE_HEIGHT}>
          <pre className={cn("p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words", !file.isContent && "text-muted-foreground")}>
            {html === null ? file.text : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
}
