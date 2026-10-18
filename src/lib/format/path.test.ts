import { describe, expect, it } from "vitest";
import { disambiguate, formatPath, homeDirFromClaudePath } from "./path";

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
});

describe("homeDirFromClaudePath", () => {
  it("reads home from the default ~/.claude location", () => {
    expect(homeDirFromClaudePath("/Users/jack/.claude")).toBe("/Users/jack");
    expect(homeDirFromClaudePath("/Users/jack/.claude/")).toBe("/Users/jack");
    expect(homeDirFromClaudePath("C:\\Users\\jack\\.claude")).toBe("C:\\Users\\jack");
  });

  it("returns null when the folder is not named .claude", () => {
    expect(homeDirFromClaudePath("/Volumes/backup/claude-config")).toBeNull();
    expect(homeDirFromClaudePath("")).toBeNull();
    expect(homeDirFromClaudePath(undefined)).toBeNull();
    expect(homeDirFromClaudePath("/.claude")).toBeNull();
  });
});
