/**
 * Starting a run, and watching it.
 *
 * The plan is fetched first and its counts are sent back with the request;
 * the server refuses anything that does not match what it would compute right
 * now. So a page left open while somebody edited the spec cannot start the
 * old plan — it gets the new numbers, and a human reads them again.
 *
 * Nothing here decides anything about the run. It relays what `plan()` said
 * and the events the run emits — the same events the CLI prints and the same
 * ones `--json` writes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunEvent } from "../../../../core/events.js";
import type { PlanAck, RunHandle } from "../../../../server/runs.js";
import type { WorkflowPlan } from "../../../../core/plan.js";
import { del, getJson, postJson } from "@/lib/api";

export type Phase = "idle" | "planning" | "ready" | "running" | "ended";

export interface PlanResponse {
  plan: WorkflowPlan;
  ack: PlanAck;
}

export interface Run {
  phase: Phase;
  ack: PlanAck | null;
  handle: RunHandle | null;
  events: RunEvent[];
  error: string | null;
  fetchPlan: () => Promise<void>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Put the plan away without running — back to just the button. Ignored while running. */
  dismiss: () => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useRun(task: string, onFinished: () => void): Run {
  const [phase, setPhase] = useState<Phase>("idle");
  const [planned, setPlanned] = useState<PlanResponse | null>(null);
  const [handle, setHandle] = useState<RunHandle | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);

  // A different task means a different plan; never carry one over.
  useEffect(() => {
    setPhase("idle");
    setPlanned(null);
    setHandle(null);
    setEvents([]);
    setError(null);
  }, [task]);

  useEffect(() => () => source.current?.close(), []);

  const fetchPlan = useCallback(async () => {
    setPhase("planning");
    setError(null);
    try {
      setPlanned(await getJson<PlanResponse>(`/api/plan/${encodeURIComponent(task)}`));
      setPhase("ready");
    } catch (e: unknown) {
      setError(message(e));
      setPhase("idle");
    }
  }, [task]);

  const watch = useCallback(
    (started: RunHandle) => {
      const es = new EventSource(`/api/runs/${started.id}/events`);
      source.current = es;
      es.onmessage = (m) => setEvents((prev) => [...prev, JSON.parse(m.data as string) as RunEvent]);
      es.addEventListener("end", (m) => {
        setHandle(JSON.parse((m as MessageEvent).data as string) as RunHandle);
        setPhase("ended");
        es.close();
        onFinished();
      });
      es.onerror = () => {
        es.close();
        setPhase("ended");
      };
    },
    [onFinished],
  );

  const start = useCallback(async () => {
    if (!planned) return;
    setError(null);
    setEvents([]);
    try {
      const res = await postJson<RunHandle & { ack?: PlanAck }>("/api/runs", {
        task,
        ack: planned.ack,
        html: true,
      });
      if (res.status === 409 && res.body.ack) {
        // The plan moved under us. Show the new numbers; do not start.
        setPlanned({ plan: planned.plan, ack: res.body.ack });
        throw new Error(`${res.body.error} — the numbers have changed, please review them again`);
      }
      if (!res.ok) throw new Error(res.body.error ?? `HTTP ${res.status}`);
      setHandle(res.body);
      setPhase("running");
      watch(res.body);
    } catch (e: unknown) {
      setError(message(e));
      setPhase("ready");
    }
  }, [planned, task, watch]);

  const cancel = useCallback(async () => {
    if (handle) await del(`/api/runs/${handle.id}`);
  }, [handle]);

  const dismiss = useCallback(() => {
    if (phase === "running") return;
    setPhase("idle");
    setPlanned(null);
    setHandle(null);
    setEvents([]);
    setError(null);
  }, [phase]);

  return { phase, ack: planned?.ack ?? null, handle, events, error, fetchPlan, start, cancel, dismiss };
}
