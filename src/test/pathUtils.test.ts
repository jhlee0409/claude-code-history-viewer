import { describe, expect, it } from "vitest";
import {
  elideProjectRoot,
  getCompactParentPath,
  getDisplayPathParts,
  getPathLeaf,
  isProjectPathUnavailable,
} from "../utils/pathUtils";

describe("path display utilities", () => {
  it("returns the leaf segment for a deep Unix path", () => {
    expect(getPathLeaf("/Users/alex/Projects/GitHub/acme/my-repo")).toBe(
      "my-repo"
    );
  });

  it("returns the leaf segment for a Windows path", () => {
    expect(getPathLeaf("C:\\Users\\alex\\Projects\\acme\\my-repo")).toBe(
      "my-repo"
    );
  });

  it("compacts macOS home-directory parents with a tilde", () => {
    expect(getCompactParentPath("/Users/alex/Projects/GitHub/acme/my-repo")).toBe(
      "... / Projects / GitHub / acme"
    );
  });

  it("compacts Linux home-directory parents with a tilde", () => {
    expect(getCompactParentPath("/home/alex/code/acme/my-repo")).toBe(
      "~ / code / acme"
    );
  });

  it("compacts Windows home-directory parents with a tilde", () => {
    expect(getDisplayPathParts("C:\\Users\\alex\\Projects\\acme\\my-repo")).toEqual([
      "~",
      "Projects",
      "acme",
      "my-repo",
    ]);
    expect(getDisplayPathParts("C:/Users/alex/Projects/acme/my-repo")).toEqual([
      "~",
      "Projects",
      "acme",
      "my-repo",
    ]);
    expect(getDisplayPathParts("/C:/Users/alex/Projects/acme/my-repo")).toEqual([
      "~",
      "Projects",
      "acme",
      "my-repo",
    ]);
  });

  it("strips Windows drive letters from compact display paths", () => {
    expect(getDisplayPathParts("D:\\work\\acme\\my-repo")).toEqual([
      "work",
      "acme",
      "my-repo",
    ]);
    expect(getCompactParentPath("D:\\work\\acme\\my-repo")).toBe("work / acme");
  });

  it("normalizes iCloud Drive's internal folder name", () => {
    const path =
      "/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/Research/OB/my-repo";

    expect(getDisplayPathParts(path)).toEqual([
      "iCloud Drive",
      "Research",
      "OB",
      "my-repo",
    ]);
    expect(getCompactParentPath(path)).toBe("iCloud Drive / Research / OB");
  });

  it("recognizes an unavailable project location without changing path formatting", () => {
    expect(isProjectPathUnavailable({ path_status: "unavailable" })).toBe(true);
    expect(isProjectPathUnavailable({})).toBe(false);
    expect(isProjectPathUnavailable(null)).toBe(false);
  });
});

describe("elideProjectRoot", () => {
  it("strips the project root from a Unix path", () => {
    expect(
      elideProjectRoot(
        "/Users/alex/Projects/my-app/skills/deliver-prd/TEMPLATE.md",
        "/Users/alex/Projects/my-app"
      )
    ).toBe("skills/deliver-prd/TEMPLATE.md");
  });

  it("strips the project root from a Windows path and normalizes separators", () => {
    expect(
      elideProjectRoot(
        "E:\\Projects\\my-app\\skills\\deliver-prd\\TEMPLATE.md",
        "E:\\Projects\\my-app"
      )
    ).toBe("skills/deliver-prd/TEMPLATE.md");
  });

  it("ignores case on Windows paths, including the drive letter", () => {
    // Measured on real data: scan_projects can report `e:\Projects\...` while the
    // session logs record `E:\Projects\...` for the same project.
    expect(
      elideProjectRoot(
        "E:\\Projects\\My-App\\src\\main.ts",
        "e:\\projects\\my-app"
      )
    ).toBe("src/main.ts");
  });

  it("keeps case significant on Unix paths", () => {
    expect(
      elideProjectRoot("/Users/alex/Projects/My-App/src/main.ts", "/users/alex/projects/my-app")
    ).toBe("/Users/alex/Projects/My-App/src/main.ts");
  });

  it("returns the path unchanged when it is not under the root", () => {
    expect(
      elideProjectRoot("/Users/alex/elsewhere/notes.md", "/Users/alex/Projects/my-app")
    ).toBe("/Users/alex/elsewhere/notes.md");
  });

  it("does not treat a name-prefixed sibling directory as a child", () => {
    expect(
      elideProjectRoot("/Users/alex/Projects/my-app-docs/README.md", "/Users/alex/Projects/my-app")
    ).toBe("/Users/alex/Projects/my-app-docs/README.md");
  });

  it("returns the path unchanged when there is no root", () => {
    const path = "/Users/alex/Projects/my-app/src/main.ts";
    expect(elideProjectRoot(path, undefined)).toBe(path);
    expect(elideProjectRoot(path, "")).toBe(path);
  });

  it("returns an empty string when the path is the root itself", () => {
    expect(
      elideProjectRoot("/Users/alex/Projects/my-app", "/Users/alex/Projects/my-app")
    ).toBe("");
  });

  it("does not treat a relative path as living under a UNC root (P2-12)", () => {
    // Splitting on separators alone threw away what kind of root each path had,
    // so these two unrelated paths looked like parent and child.
    expect(
      elideProjectRoot(
        "server/share/repo/src/a.ts",
        "\\\\server\\share\\repo"
      )
    ).toBe("server/share/repo/src/a.ts");
  });

  it("matches an extended-length path against its plain drive root (P2-12)", () => {
    // `\\?\C:` and `C:` name the same volume; the prefix is a Win32 escape.
    expect(
      elideProjectRoot("\\\\?\\C:\\repo\\src\\a.ts", "C:\\repo")
    ).toBe("src/a.ts");
  });

  it("tolerates a trailing separator on the root", () => {
    expect(
      elideProjectRoot("/Users/alex/Projects/my-app/src/main.ts", "/Users/alex/Projects/my-app/")
    ).toBe("src/main.ts");
  });
});
