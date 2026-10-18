import { describe, expect, it } from "vitest";
import { disambiguate, formatPath, homeDirFromDefaultClaudePath, type FormattedPath } from "./path";

const display = (p: { dir: string; name: string }) => `${p.dir}${p.name}`;

describe("formatPath", () => {
  const projectRoot = "/Users/jack/client/app";
  const homeDir = "/Users/jack";

  it("shortens a path under the message cwd first", () => {
    const out = formatPath("/Users/jack/client/app/packages/ui/src/Button.tsx", {
      cwd: "/Users/jack/client/app/packages/ui",
      projectRoot,
      homeDir,
    });
    expect(out).toEqual({
      dir: "src/",
      name: "Button.tsx",
      full: "/Users/jack/client/app/packages/ui/src/Button.tsx",
      kind: "cwd",
    });
  });

  it("falls back to the project root when the path is outside the cwd", () => {
    // The session's cwd moved into a sub-folder mid-session: a file elsewhere
    // in the project still reads relative to the project, not as `../`.
    const out = formatPath("/Users/jack/client/app/docs/README.md", {
      cwd: "/Users/jack/client/app/packages/ui",
      projectRoot,
      homeDir,
    });
    expect(out.kind).toBe("project");
    expect(display(out)).toBe("docs/README.md");
  });

  it("uses ~ for a path under home but outside the project", () => {
    const out = formatPath("/Users/jack/.claude/settings.json", { projectRoot, homeDir });
    expect(out).toMatchObject({ kind: "home", dir: "~/.claude/", name: "settings.json" });
  });

  it("returns the home directory itself as ~", () => {
    expect(formatPath("/Users/jack", { homeDir })).toMatchObject({ kind: "home", dir: "", name: "~" });
  });

  it("keeps the path whole as absolute when nothing justifies shortening it", () => {
    for (const path of ["/opt/homebrew/etc/nginx.conf", "/var/log/system.log", "/tmp/x/a.txt", "/private/etc/hosts", "/mnt/data/a.csv", "/home/other/a.txt"]) {
      const out = formatPath(path, { projectRoot, homeDir });
      expect(out.kind).toBe("absolute");
      expect(display(out)).toBe(path);
      expect(out.full).toBe(path);
    }
  });

  it("never shortens against a different project that merely shares a prefix", () => {
    const out = formatPath("/Users/jack/client/app-v2/src/a.ts", { projectRoot });
    expect(out.kind).toBe("absolute");
    expect(display(out)).toBe("/Users/jack/client/app-v2/src/a.ts");
  });

  it("does not use a filesystem root as a base", () => {
    expect(formatPath("/etc/hosts", { cwd: "/", projectRoot: "/" }).kind).toBe("absolute");
    expect(formatPath("C:\\Windows\\win.ini", { cwd: "C:\\" }).kind).toBe("absolute");
  });

  it("does not shorten the base against itself", () => {
    // A project row shows its own root; relative to itself it would be empty.
    const out = formatPath(projectRoot, { projectRoot, homeDir });
    expect(out).toMatchObject({ kind: "home", dir: "~/client/", name: "app" });
  });

  it("handles Windows drive paths case-insensitively", () => {
    const out = formatPath("c:\\Users\\Jack\\proj\\src\\main.rs", {
      projectRoot: "C:\\Users\\jack\\proj",
    });
    expect(out).toMatchObject({ kind: "project", dir: "src/", name: "main.rs" });
  });

  it("shortens a Windows home path with ~", () => {
    const out = formatPath("C:\\Users\\jack\\AppData\\Roaming\\Code\\settings.json", {
      homeDir: "C:\\Users\\jack",
    });
    expect(out).toMatchObject({ kind: "home", dir: "~/AppData/Roaming/Code/", name: "settings.json" });
  });

  it("keeps an absolute Windows path in its own separators", () => {
    const out = formatPath("D:\\data\\logs\\app.log", { projectRoot: "C:\\proj" });
    expect(out).toMatchObject({ kind: "absolute", dir: "D:\\data\\logs\\", name: "app.log" });
  });

  it("handles UNC and WSL roots", () => {
    expect(
      formatPath("\\\\server\\share\\team\\notes.md", { projectRoot: "\\\\server\\share\\team" }),
    ).toMatchObject({ kind: "project", dir: "", name: "notes.md" });

    const wsl = formatPath("\\\\wsl$\\Ubuntu\\home\\me\\proj\\src\\lib.rs", {
      projectRoot: "\\\\wsl$\\Ubuntu\\home\\me\\proj",
    });
    expect(wsl).toMatchObject({ kind: "project", dir: "src/", name: "lib.rs" });

    const unrelated = formatPath("\\\\server\\share\\other.md", { projectRoot: "C:\\proj" });
    expect(unrelated).toMatchObject({ kind: "absolute", dir: "\\\\server\\share\\", name: "other.md" });
  });

  it("treats the extended-length prefix as the same path", () => {
    const out = formatPath("\\\\?\\C:\\proj\\src\\a.ts", { projectRoot: "C:\\proj" });
    expect(out).toMatchObject({ kind: "project", dir: "src/", name: "a.ts" });
    expect(out.full).toBe("\\\\?\\C:\\proj\\src\\a.ts");
  });

  it("keeps a symlinked spelling as a string (no resolution)", () => {
    // /tmp is a symlink to /private/tmp on macOS; the formatter does not touch
    // the disk, so the two spellings are different strings.
    const out = formatPath("/private/tmp/proj/a.ts", { projectRoot: "/tmp/proj" });
    expect(out.kind).toBe("absolute");
    expect(display(out)).toBe("/private/tmp/proj/a.ts");
  });

  it("keeps the file name whole for a very long path", () => {
    const deep = `/Users/jack/${"very-long-folder-name/".repeat(20)}a-really-long-file-name-that-must-not-be-cut.test.tsx`;
    const out = formatPath(deep, { homeDir });
    expect(out.name).toBe("a-really-long-file-name-that-must-not-be-cut.test.tsx");
    expect(out.dir.startsWith("~/very-long-folder-name/")).toBe(true);
    expect(out.full).toBe(deep);
  });

  it("passes a relative or empty input through unchanged", () => {
    expect(formatPath("src/a.ts", { projectRoot })).toMatchObject({ kind: "absolute", dir: "src/", name: "a.ts" });
    expect(formatPath("", { projectRoot })).toMatchObject({ kind: "absolute", dir: "", name: "", full: "" });
  });

  it("ignores a trailing separator when splitting the name", () => {
    expect(formatPath("/opt/tools/", {})).toMatchObject({ kind: "absolute", dir: "/opt/", name: "tools" });
    expect(formatPath("/", {})).toMatchObject({ kind: "absolute", dir: "", name: "/" });
  });
});

describe("disambiguate", () => {
  const ctx = { projectRoot: "/p" };
  const f = (path: string) => formatPath(path, ctx);

  it("adds no hint to unique names", () => {
    expect(disambiguate([f("/p/src/a.ts"), f("/p/src/b.ts")])).toEqual(["", ""]);
  });

  it("shows parent folders until three same-named files differ", () => {
    const hints = disambiguate([
      f("/p/src/app/index.ts"),
      f("/p/src/lib/index.ts"),
      f("/p/test/lib/index.ts"),
      f("/p/README.md"),
    ]);
    expect(hints).toEqual(["app", "src/lib", "test/lib", ""]);
  });

  it("handles a same-named file at the root of the base", () => {
    expect(disambiguate([f("/p/index.ts"), f("/p/a/index.ts")])).toEqual(["", "a"]);
  });

  it("gives exact duplicates the same hint without looping", () => {
    expect(disambiguate([f("/p/a/x.ts"), f("/p/a/x.ts"), f("/p/b/x.ts")])).toEqual(["a", "a", "b"]);
  });

  it("keeps the root spelling when a path runs out of folders", () => {
    const hints = disambiguate([
      formatPath("/opt/x/config.json", {}),
      formatPath("/Users/me/x/config.json", { homeDir: "/Users/me" }),
    ]);
    expect(hints).toEqual(["/opt/x", "~/x"]);
  });

  it("works across Windows separators", () => {
    const hints = disambiguate([
      formatPath("D:\\a\\util.ts", {}),
      formatPath("D:\\b\\util.ts", {}),
    ]);
    expect(hints).toEqual(["a", "b"]);
  });

  it("tells apart files whose shortened labels match but whose bases differ", () => {
    // cwd `/p/src` and project `/p` both shorten to `lib/index.ts`.
    const mixed = { cwd: "/p/src", projectRoot: "/p" };
    const paths = ["/p/src/lib/index.ts", "/p/lib/index.ts"].map((p) => formatPath(p, mixed));
    expect(paths.map(display)).toEqual(["lib/index.ts", "lib/index.ts"]);
    const hints = disambiguate(paths);
    expect(new Set(hints).size).toBe(2);
    expect(hints).toEqual(["src/lib", "/p/lib"]);
  });

  it("tells apart same-named files at the root of two different bases", () => {
    const paths = [
      formatPath("/p/src/index.ts", { cwd: "/p/src", projectRoot: "/p" }),
      formatPath("/p/index.ts", { cwd: "/p/src", projectRoot: "/p" }),
    ];
    const hints = disambiguate(paths);
    expect(hints[0]).not.toBe(hints[1]);
  });

  it("gives every distinct file a distinct label (random path sets)", () => {
    // Deterministic PRNG so a failure is reproducible from the seed.
    let seed = 0x5eed;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pick = <T,>(xs: readonly T[]) => xs[rand(xs.length)] as T;
    const folders = ["p", "src", "lib", "a", "b", "home", "u", "x"] as const;
    const names = ["index.ts", "a.ts", "x"] as const;
    const roots = ["/", "/p/", "/p/src/", "/home/u/", "/home/u/p/", "/opt/", "C:\\p\\"] as const;
    const contexts = [
      {},
      { projectRoot: "/p" },
      { cwd: "/p/src", projectRoot: "/p" },
      { cwd: "/p/src/lib", projectRoot: "/p", homeDir: "/home/u" },
      { projectRoot: "/home/u/p", homeDir: "/home/u" },
    ] as const;

    for (let round = 0; round < 400; round += 1) {
      const count = 2 + rand(7);
      const paths: FormattedPath[] = [];
      for (let i = 0; i < count; i += 1) {
        const root = pick(roots);
        const sep = root.includes("\\") ? "\\" : "/";
        const depth = rand(4);
        const segments = Array.from({ length: depth }, () => pick(folders));
        const full = `${root}${[...segments, pick(names)].join(sep)}`;
        paths.push(formatPath(full, pick(contexts)));
      }
      // Re-use some exact paths so duplicates are exercised too.
      if (rand(3) === 0) paths.push({ ...(paths[0] as FormattedPath) });

      const hints = disambiguate(paths);
      expect(hints).toHaveLength(paths.length);
      for (let i = 0; i < paths.length; i += 1) {
        for (let j = i + 1; j < paths.length; j += 1) {
          const a = paths[i] as FormattedPath;
          const b = paths[j] as FormattedPath;
          const context = `round ${round}: ${a.full} vs ${b.full} -> ${JSON.stringify(hints)}`;
          if (a.full === b.full) {
            // The same file: shown the same way, it reads the same way.
            if (display(a) === display(b)) expect(hints[i], context).toBe(hints[j]);
          } else if (a.name === b.name) {
            expect(hints[i], context).not.toBe(hints[j]);
          }
        }
      }
      // A name nobody else has needs no hint.
      paths.forEach((p, i) => {
        const rivals = paths.filter((q) => q.full !== p.full && q.name === p.name);
        if (rivals.length === 0) expect(hints[i]).toBe("");
      });
    }
  });
});

describe("homeDirFromDefaultClaudePath", () => {
  it("reads home from the backend's default <home>/.claude", () => {
    expect(homeDirFromDefaultClaudePath("/Users/jack/.claude")).toBe("/Users/jack");
    expect(homeDirFromDefaultClaudePath("/Users/jack/.claude/")).toBe("/Users/jack");
    expect(homeDirFromDefaultClaudePath("C:\\Users\\jack\\.claude")).toBe("C:\\Users\\jack");
  });

  it("returns null for anything that is not <home>/.claude", () => {
    expect(homeDirFromDefaultClaudePath("/Volumes/backup/claude-config")).toBeNull();
    expect(homeDirFromDefaultClaudePath("")).toBeNull();
    expect(homeDirFromDefaultClaudePath(undefined)).toBeNull();
    expect(homeDirFromDefaultClaudePath("/.claude")).toBeNull();
  });
});
