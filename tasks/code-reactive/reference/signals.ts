/**
 * Reference solution for inputs/code-reactive.txt. Its only job is to prove the
 * task is solvable and that spec.test.ts passes for a correct implementation.
 * Never shown to a candidate: the agent only ever sees the task text.
 *
 * Push the invalidation, pull the value: a write marks direct observers DIRTY
 * and everything downstream CHECK, then each reader decides whether a source
 * actually changed. That is what keeps a diamond glitch-free.
 */

export type Dispose = () => void;

export interface Signal<T> {
  (): T;
  set(next: T): void;
}

export class CycleError extends Error {
  constructor(message = "cyclic computed") {
    super(message);
    this.name = "CycleError";
  }
}

type Equals<T> = (a: T, b: T) => boolean;

const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

interface Source {
  version: number;
  observers: Set<Reactive>;
  bringUpToDate(): void;
}

interface Reactive {
  state: number;
  sources: Source[];
  sourceVersions: number[];
  isEffect: boolean;
  observers: Set<Reactive>;
  notify(state: number): void;
}

let activeObserver: Reactive | null = null;
let batchDepth = 0;
const pending = new Set<EffectNode>();

const defaultEquals = <T>(a: T, b: T): boolean => Object.is(a, b);

function track(source: Source): void {
  const observer = activeObserver;
  if (!observer) return;
  observer.sources.push(source);
  observer.sourceVersions.push(source.version);
  source.observers.add(observer);
}

function propagate(source: Source, state: number): void {
  for (const observer of [...source.observers]) observer.notify(state);
}

function flush(): void {
  if (batchDepth > 0) return;
  while (pending.size > 0) {
    const [next] = pending;
    pending.delete(next);
    next.runIfNecessary();
  }
}

function unsubscribeAll(node: Reactive): void {
  for (const source of node.sources) source.observers.delete(node);
  node.sources = [];
  node.sourceVersions = [];
}

/** True when some source's value moved since this node last read it. */
function sourcesChanged(node: Reactive): boolean {
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    source.bringUpToDate();
    if (source.version !== node.sourceVersions[i]) return true;
  }
  return false;
}

/** Runs `body` with `node` as the tracking observer and rebuilds its sources. */
function withTracking<T>(node: Reactive, body: () => T): T {
  const previousSources = node.sources;
  const previousObserver = activeObserver;
  node.sources = [];
  node.sourceVersions = [];
  activeObserver = node;
  try {
    return body();
  } finally {
    activeObserver = previousObserver;
    const kept = new Set(node.sources);
    for (const source of previousSources) {
      if (!kept.has(source)) source.observers.delete(node);
    }
  }
}

class SignalNode<T> implements Source {
  version = 0;
  observers = new Set<Reactive>();

  constructor(
    private value: T,
    private readonly equals: Equals<T>,
  ) {}

  bringUpToDate(): void {}

  read(): T {
    track(this);
    return this.value;
  }

  write(next: T): void {
    if (this.equals(this.value, next)) return;
    this.value = next;
    this.version += 1;
    propagate(this, DIRTY);
    flush();
  }
}

class ComputedNode<T> implements Source, Reactive {
  version = 0;
  state = DIRTY;
  sources: Source[] = [];
  sourceVersions: number[] = [];
  observers = new Set<Reactive>();
  readonly isEffect = false;
  private value!: T;
  private initialized = false;
  private computing = false;

  constructor(
    private readonly fn: () => T,
    private readonly equals: Equals<T>,
  ) {}

  notify(state: number): void {
    if (this.state >= state) return;
    const wasClean = this.state === CLEAN;
    this.state = state;
    if (wasClean) propagate(this, CHECK);
  }

  bringUpToDate(): void {
    if (this.state === CLEAN) return;
    if (this.computing) throw new CycleError();
    if (this.state === CHECK) {
      if (!sourcesChanged(this)) {
        this.state = CLEAN;
        return;
      }
    }
    this.recompute();
  }

  read(): T {
    if (this.computing) throw new CycleError();
    this.bringUpToDate();
    track(this);
    return this.value;
  }

  private recompute(): void {
    this.computing = true;
    let next: T;
    try {
      next = withTracking(this, this.fn);
    } catch (error) {
      this.state = DIRTY;
      throw error;
    } finally {
      this.computing = false;
    }
    this.state = CLEAN;
    if (!this.initialized || !this.equals(this.value, next)) {
      this.value = next;
      this.initialized = true;
      this.version += 1;
    }
  }
}

class EffectNode implements Reactive {
  state = DIRTY;
  sources: Source[] = [];
  sourceVersions: number[] = [];
  observers = new Set<Reactive>();
  readonly isEffect = true;
  private cleanups: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly fn: (onCleanup: (f: () => void) => void) => void) {}

  notify(state: number): void {
    if (this.state >= state) return;
    this.state = state;
    pending.add(this);
  }

  runIfNecessary(): void {
    if (this.disposed || this.state === CLEAN) return;
    if (this.state === CHECK && !sourcesChanged(this)) {
      this.state = CLEAN;
      return;
    }
    this.run();
  }

  run(): void {
    if (this.disposed) return;
    this.runCleanups();
    const register = (f: () => void): void => void this.cleanups.push(f);
    withTracking(this, () => this.fn(register));
    this.state = CLEAN;
  }

  private runCleanups(): void {
    const queued = this.cleanups;
    this.cleanups = [];
    for (const f of queued) f();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    pending.delete(this);
    unsubscribeAll(this);
    this.runCleanups();
  }
}

export function signal<T>(initial: T, equals: Equals<T> = defaultEquals): Signal<T> {
  const node = new SignalNode(initial, equals);
  const read = (): T => node.read();
  read.set = (next: T): void => node.write(next);
  return read;
}

export function computed<T>(fn: () => T, equals: Equals<T> = defaultEquals): () => T {
  const node = new ComputedNode(fn, equals);
  return () => node.read();
}

export function effect(fn: (onCleanup: (f: () => void) => void) => void): Dispose {
  const node = new EffectNode(fn);
  node.run();
  return () => node.dispose();
}

export function batch<T>(fn: () => T): T {
  batchDepth += 1;
  try {
    return fn();
  } finally {
    batchDepth -= 1;
    flush();
  }
}

export function untracked<T>(fn: () => T): T {
  const previous = activeObserver;
  activeObserver = null;
  try {
    return fn();
  } finally {
    activeObserver = previous;
  }
}
