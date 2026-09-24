/** The line across the bottom, as on the protocol site: what this implements, and who keeps it. */

import { PROTOCOL_VERSION } from "../../../spec/schema.js";

export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p>Agentic Evaluator · Agent Evaluation Protocol v{PROTOCOL_VERSION} draft · maintained by 57Blocks</p>
        <p>Implementation-neutral: no framework, gateway, provider or judge model required.</p>
      </div>
    </footer>
  );
}
