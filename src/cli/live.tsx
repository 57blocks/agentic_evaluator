/**
 * `agenteval run` on an interactive terminal: permanent lines above, one
 * redrawn progress block below.
 *
 * Only a renderer. The state is `progress.ts`, the wording of every kept line
 * is `print.ts`, and anything that is not a TTY — a pipe, CI, `--json` — never
 * gets here and reads the plain line printer instead.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { Box, render, Static, Text } from "ink";
import type { RunEventSink } from "../core/events.js";
import { initialProgress, reduceProgress, type Progress, type Tally } from "./progress.js";

const BAR_WIDTH = 16;
const TICK_MS = 1000;

interface Store {
  get: () => Progress;
  subscribe: (listener: () => void) => () => void;
  sink: RunEventSink;
}

function createStore(): Store {
  let state = initialProgress();
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    sink: (event) => {
      state = reduceProgress(state, event);
      for (const listener of listeners) listener();
    },
  };
}

function bar(t: Tally): string {
  if (t.total === null || t.total === 0) return "";
  const filled = Math.min(BAR_WIDTH, Math.round((t.done / t.total) * BAR_WIDTH));
  return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)} `;
}

interface TallyRowProps {
  label: string;
  tally: Tally;
  isCurrent: boolean;
}

function TallyRow({ label, tally, isCurrent }: TallyRowProps) {
  if (tally.total === 0) return null;
  const of = tally.total === null ? `${tally.done}` : `${tally.done}/${tally.total}`;
  return (
    <Text dimColor={!isCurrent}>
      {"  "}
      {label.padEnd(12)}
      {bar(tally)}
      {of}
      {tally.failed > 0 ? <Text color="red"> · {tally.failed} failed</Text> : null}
    </Text>
  );
}

function useElapsedSeconds(): number {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return Math.floor((now - startedAt) / 1000);
}

interface LiveRunProps {
  store: Store;
}

function LiveRun({ store }: LiveRunProps) {
  const p = useSyncExternalStore(store.subscribe, store.get);
  const seconds = useElapsedSeconds();
  const counts = p.active ? p.counts[p.active] : undefined;
  return (
    <>
      <Static items={[...p.log]}>{(line) => <Text key={line.id}>{line.text}</Text>}</Static>
      {p.finished || !p.active ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color="cyan">● {p.active}</Text>
            <Text dimColor>
              {" "}
              · {p.phase ?? "generating"} · {seconds}s · generation spend ${p.spentUsd.toFixed(4)}
            </Text>
          </Text>
          {counts ? (
            <>
              <TallyRow label="generations" tally={counts.generations} isCurrent={(p.phase ?? "generating") === "generating"} />
              <TallyRow label="judging" tally={counts.judging} isCurrent={p.phase === "judging"} />
              <TallyRow label="scoring" tally={counts.scoring} isCurrent={p.phase === "scoring"} />
            </>
          ) : null}
        </Box>
      )}
    </>
  );
}

export interface LiveView {
  sink: RunEventSink;
  /** Draw the last frame and give the terminal back. Safe to call once, always. */
  close: () => Promise<void>;
}

export function liveView(): LiveView {
  const store = createStore();
  const instance = render(<LiveRun store={store} />, { patchConsole: true });
  return {
    sink: store.sink,
    close: async () => {
      await instance.waitUntilRenderFlush();
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}
