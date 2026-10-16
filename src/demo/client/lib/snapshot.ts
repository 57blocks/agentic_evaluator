/**
 * A read-only export of the dashboard (`agenteval dash --export`) carries
 * every response the pages read, keyed by the URL they ask for. The export's
 * data files fill `window.__AGENTEVAL_SNAPSHOT__` before the app starts; when
 * it is there, reads are answered from it and nothing that would change the
 * workspace (start a run, record a review) is offered.
 */

export interface SnapshotEntry {
  status: number;
  body: string;
}

export interface SnapshotMeta {
  exportedAt: string;
  workspace: string;
}

declare global {
  interface Window {
    __AGENTEVAL_SNAPSHOT__?: Record<string, SnapshotEntry>;
    __AGENTEVAL_SNAPSHOT_META__?: SnapshotMeta;
  }
}

const data = (): Record<string, SnapshotEntry> | undefined =>
  typeof window === "undefined" ? undefined : window.__AGENTEVAL_SNAPSHOT__;

export const isSnapshot = (): boolean => data() !== undefined;

export const snapshotMeta = (): SnapshotMeta | null =>
  (typeof window === "undefined" ? undefined : window.__AGENTEVAL_SNAPSHOT_META__) ?? null;

/** The recorded response for `url`, or a 404 for anything the export did not record. */
export function snapshotResponse(url: string): SnapshotEntry {
  return data()?.[url] ?? { status: 404, body: "" };
}

/** A link to a file the export wrote beside index.html: drop the leading slash so it resolves from the page. */
export const exportedHref = (href: string): string => (isSnapshot() ? `.${href}` : href);

export const READ_ONLY = "This is a read-only export of the dashboard: runs and reviews are not available here.";
