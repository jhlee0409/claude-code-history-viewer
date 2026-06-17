import { describe, expect, it } from "vitest";
import {
  getCompactParentPath,
  getDisplayPathParts,
  getPathLeaf,
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
});
