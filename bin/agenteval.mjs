#!/usr/bin/env node
/**
 * The installed entry point.
 *
 * TypeScript sources are shipped and run through tsx rather than compiled to
 * a dist/: the harness spawns its own `tsc` for required checks, so the
 * toolchain is present either way, and shipping the sources keeps the code a
 * user is debugging identical to the code that ran.
 *
 * tsx is registered through `tsx/esm/api`, which is the supported route on
 * Node 20+ — `register("tsx/esm", …)` is the deprecated loader path and
 * refuses to load at all on current Node.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";

const here = path.dirname(fileURLToPath(import.meta.url));
// Compile with the package's own tsconfig, not whatever tsconfig (or none)
// sits in the directory the user runs from — without it the JSX in the live
// view compiles for the wrong runtime ("React is not defined").
register({ tsconfig: path.join(here, "..", "tsconfig.json") });
const { cli } = await import(pathToFileURL(path.join(here, "..", "src", "cli", "index.ts")).href);
await cli();
