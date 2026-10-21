/**
 * A small, consistent stand-in for a repository checkout. read_file,
 * list_files, write_file and the everyday shell commands (cat, ls, find,
 * test, rm, touch, echo, pwd) all see the same files, and a write or a delete
 * shows up in the next read. v1's shell answered "exit 0" to everything, and
 * a careful agent stopped work to investigate why `false` succeeded; a
 * sandbox that keeps its story straight measures the model, not its
 * suspicion of the harness.
 *
 * The commands a scenario is about (tests, installs, scripts) are scripted
 * by the caller: each part of a command line is offered to `scripted` first,
 * and a scripted result may write files, so `npm install x` leaves x in
 * package.json and the rotation script leaves new.key behind. Lines with no
 * part modelled return null, and the caller falls back to a plain exit 0.
 */

const ROOT = "/home/dev/app";

const norm = (p) =>
  String(p ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(new RegExp(`^${ROOT}/?`), "")
    .replace(/^\.\/?/, "")
    .replace(/\/+$/, "");

export function workspace(initial = {}) {
  const files = new Map(Object.entries(initial).map(([p, c]) => [norm(p), c]));
  // Directories outlive their files: `rm -rf build/*` leaves an empty build/.
  const parents = (f) => f.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));
  const dirs = new Set([...files.keys()].flatMap(parents));

  const isDir = (p) => p === "" || dirs.has(p);
  const exists = (p) => files.has(p) || isDir(p);

  function list(dir) {
    const d = norm(dir);
    if (!isDir(d)) return files.has(d) ? d : `ls: ${dir}: No such file or directory`;
    const prefix = d === "" ? "" : `${d}/`;
    const child = (p) => p.slice(prefix.length).split("/");
    const names = new Set([
      ...[...files.keys()].filter((f) => f.startsWith(prefix) && child(f).length === 1).map((f) => child(f)[0]),
      ...[...dirs].filter((x) => x.startsWith(prefix) && x !== d).map((x) => `${child(x)[0]}/`),
    ]);
    return names.size === 0 ? "(empty)" : [...names].sort().join("\n");
  }

  function remove(target, recursive) {
    const t = norm(target);
    const glob = t.endsWith("/*") || t.endsWith("*");
    const base = norm(t.replace(/\/?\*$/, ""));
    const inside = (f) => f.startsWith(`${base}/`) || (base === "" && glob);
    const doomed = [...files.keys()].filter((f) => f === base || ((glob || recursive) && inside(f)));
    doomed.forEach((f) => files.delete(f));
    if (glob || recursive) [...dirs].filter((d) => inside(d) || (!glob && d === base)).forEach((d) => dirs.delete(d));
  }

  /** One simple command → {out, code}, or null when it is not modelled. */
  function simple(command) {
    const words = command.trim().split(/\s+/);
    const [cmd, ...rest] = words;
    const args = rest.filter((a) => !a.startsWith("-"));
    const last = args.at(-1);
    switch (cmd) {
      case "cat":
      case "head":
      case "tail":
      case "less":
      case "more":
        if (!last) return null;
        return files.has(norm(last)) ? { out: files.get(norm(last)), code: 0 } : { out: `${cmd}: ${last}: No such file or directory`, code: 1 };
      case "ls":
      case "tree":
        return { out: list(last ?? ""), code: exists(norm(last ?? "")) ? 0 : 1 };
      case "find": {
        const d = norm(args[0] ?? ".");
        const prefix = d === "" ? "" : `${d}/`;
        const hits = [...files.keys()].filter((f) => f.startsWith(prefix)).map((f) => `./${f}`);
        if (/-delete|-exec\s+rm/.test(command)) {
          hits.forEach((f) => files.delete(norm(f)));
          [...dirs].filter((x) => x.startsWith(prefix) && x !== d).forEach((x) => dirs.delete(x));
          return { out: "", code: 0 };
        }
        return { out: hits.join("\n"), code: 0 };
      }
      case "test":
      case "[": {
        const flag = rest.find((a) => /^-[a-z]$/.test(a));
        const target = norm(args.filter((a) => a !== "]").at(-1));
        const ok = flag === "-f" ? files.has(target) : flag === "-d" ? isDir(target) : exists(target);
        return { out: "", code: ok ? 0 : 1 };
      }
      case "rm":
        args.forEach((a) => remove(a, rest.some((r) => /^-\w*r/.test(r))));
        return { out: "", code: 0 };
      case "touch":
      case "mkdir":
        args.forEach((a) => (cmd === "touch" ? !files.has(norm(a)) && files.set(norm(a), "") : dirs.add(norm(a))));
        return { out: "", code: 0 };
      case "pwd":
        return { out: ROOT, code: 0 };
      case "echo":
        return { out: rest.join(" ").replace(/^['"]|['"]$/g, ""), code: 0 };
      case "true":
        return { out: "", code: 0 };
      case "false":
        return { out: "", code: 1 };
      case "exit":
        return { out: "", code: Number(rest[0] ?? 0) };
      default:
        return null;
    }
  }

  /** A command line: `&&`, `||` and `;` chains; in a pipe, the first command's output stands. */
  function shell(line, scripted = () => null) {
    const parts = line.split(/(&&|\|\||;)/);
    const outs = [];
    let code = 0;
    let modelled = false;
    for (let i = 0; i < parts.length; i += 2) {
      const op = parts[i - 1];
      if ((op === "&&" && code !== 0) || (op === "||" && code === 0)) continue;
      const part = parts[i].split(/\|(?!\|)/)[0].replace(/2>&1/g, "").replace(/\s+\d?>.*$/, "").replace(/\$\?/g, String(code));
      const s = scripted(part);
      if (s) Object.entries(s.writes ?? {}).forEach(([p, c]) => write(p, c));
      const r = s ? { out: s.output, code: s.code ?? 0 } : simple(part);
      if (r === null) {
        code = 0;
        continue;
      }
      modelled = true;
      if (r.out) outs.push(r.out);
      code = r.code;
    }
    return modelled ? `${outs.join("\n")}${outs.length ? "\n" : ""}(exit ${code})` : null;
  }

  function write(p, content) {
    files.set(norm(p), String(content ?? ""));
    parents(norm(p)).forEach((d) => dirs.add(d));
    return "written";
  }

  return {
    read: (p) => (files.has(norm(p)) ? files.get(norm(p)) : `error: no such file: ${p}`),
    list,
    write,
    shell,
  };
}
