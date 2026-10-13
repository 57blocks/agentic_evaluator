/**
 * Reading a task plan (`{ domains: [{ tasks: [...] }] }`, agb's
 * .ab/tasks.json shape) out of a file, for the review page's plan view.
 * Pure: no React, no DOM.
 */

export interface PlanTask {
  id?: string;
  title?: string;
  role?: string;
  description?: string;
  dependsOn?: string[];
  acceptanceCriteria?: unknown[];
  files?: unknown[];
  estLines?: number;
}

export interface PlanDomain {
  id?: string;
  name?: string;
  description?: string;
  dependsOn?: string[];
  tasks: PlanTask[];
}

export interface TaskPlan {
  domains: PlanDomain[];
  assumptions?: unknown[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * A task's files as one list: an array as is, or agb's `{ creates: [...],
 * modifies: [...] }` flattened with each entry labelled by its key.
 */
function fileList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((f) => line(f));
  if (!isRecord(v)) return [];
  return Object.entries(v).flatMap(([kind, list]) => (Array.isArray(list) ? list.map((f) => `${kind}: ${line(f)}`) : []));
}

/** The plan in a file's text, or null when it is not one (then the pane shows the file as is). */
export function parseTaskPlan(text: string): TaskPlan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.domains)) return null;
  const domains = raw.domains.filter(isRecord).filter((d) => Array.isArray(d.tasks));
  if (domains.length === 0) return null;
  return {
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions : undefined,
    domains: domains.map((d) => ({
      id: d.id === undefined ? undefined : String(d.id),
      name: d.name === undefined ? undefined : String(d.name),
      description: typeof d.description === "string" ? d.description : undefined,
      dependsOn: strings(d.dependsOn),
      tasks: (d.tasks as unknown[]).filter(isRecord).map((t) => ({
        id: t.id === undefined ? undefined : String(t.id),
        title: t.title === undefined ? undefined : String(t.title),
        role: typeof t.role === "string" ? t.role : undefined,
        description: typeof t.description === "string" ? t.description : undefined,
        dependsOn: strings(t.dependsOn),
        acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [],
        files: fileList(t.files),
        estLines: typeof t.estLines === "number" ? t.estLines : undefined,
      })),
    })),
  };
}

/** One line of text for an item that may be a string or a small object. */
export function line(v: unknown): string {
  if (typeof v === "string") return v;
  if (isRecord(v)) {
    const text = v.text ?? v.criterion ?? v.description ?? v.assumption ?? v.path ?? v.file;
    const id = v.id ? `${String(v.id)} ` : "";
    return text !== undefined ? `${id}${String(text)}` : JSON.stringify(v);
  }
  return String(v);
}

export function stats(plan: TaskPlan): { tasks: number; lines: number; crossDomain: number } {
  const domainOf = new Map<string, string>();
  for (const d of plan.domains) for (const t of d.tasks) if (t.id) domainOf.set(t.id, d.id ?? d.name ?? "");
  let crossDomain = 0;
  let lines = 0;
  for (const d of plan.domains) {
    for (const t of d.tasks) {
      lines += t.estLines ?? 0;
      crossDomain += (t.dependsOn ?? []).filter((dep) => domainOf.has(dep) && domainOf.get(dep) !== (d.id ?? d.name ?? "")).length;
    }
  }
  return { tasks: plan.domains.reduce((n, d) => n + d.tasks.length, 0), lines, crossDomain };
}
