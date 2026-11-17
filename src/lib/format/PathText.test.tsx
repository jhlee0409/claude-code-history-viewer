import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { PathText } from "./PathText";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const root = (container: HTMLElement) => container.querySelector("[data-path]") as HTMLElement;

describe("PathText", () => {
  it("shows the shortened path and keeps the full one in title and data-path", () => {
    const { container } = render(
      <PathText path="/Users/jack/client/app/src/a.ts" ctx={{ projectRoot: "/Users/jack/client/app" }} />,
    );
    const el = root(container);
    expect(el.textContent).toBe("src/a.ts");
    expect(el).toHaveAttribute("data-path", "/Users/jack/client/app/src/a.ts");
    expect(el).toHaveAttribute("data-path-kind", "project");
    expect(el).toHaveAttribute("title", "/Users/jack/client/app/src/a.ts");
    expect(el).toHaveAttribute("data-mono", "path");
  });

  it("ellipsises only the folder part and never the file name", () => {
    const { container } = render(<PathText path="/opt/some/deep/folder/file-name.json" />);
    const dir = container.querySelector('[data-path-part="dir"]');
    const name = container.querySelector('[data-path-part="name"]');
    expect(root(container)).toHaveAttribute("data-path-kind", "absolute");
    expect(dir?.textContent).toBe("/opt/some/deep/folder/");
    expect(dir?.className).toContain("truncate");
    expect(name?.textContent).toBe("file-name.json");
    expect(name?.className).not.toContain("truncate");
    expect(name?.className).toContain("break-all");
  });

  it("renders no folder part for a bare name", () => {
    const { container } = render(<PathText path="/p/README.md" ctx={{ projectRoot: "/p" }} />);
    expect(container.querySelector('[data-path-part="dir"]')).toBeNull();
    expect(root(container).textContent).toBe("README.md");
  });

  it("copies the full path when the whole text is selected", () => {
    const { container } = render(<PathText path="/home/me/proj/a.ts" ctx={{ homeDir: "/home/me" }} />);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "~/proj/\na.ts" } as Selection);
    const setData = vi.fn();
    const event = fireEvent.copy(root(container), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "/home/me/proj/a.ts");
    expect(event).toBe(false); // default prevented
  });

  it("leaves a partial selection alone", () => {
    const { container } = render(<PathText path="/home/me/proj/a.ts" ctx={{ homeDir: "/home/me" }} />);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "proj" } as Selection);
    const setData = vi.fn();
    const event = fireEvent.copy(root(container), { clipboardData: { setData } });
    expect(setData).not.toHaveBeenCalled();
    expect(event).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TR1a fix round 2 (review R2-F1): the highlighter runs over the whole shown
// path and its ranges are distributed onto the folder / name parts; a hit
// may span both (it is then two <mark> pieces, `data-search-hit-part`
// "start" in the folder, "end" in the name).
// ---------------------------------------------------------------------------

/** The search hits marked in `el`, a hit split over the folder / name parts joined into one. */
function markedHits(el: Element): string[] {
  const hits: string[] = [];
  let open: string | null = null;
  for (const mark of el.querySelectorAll("mark")) {
    const piece = mark.textContent ?? "";
    const part = mark.getAttribute("data-search-hit-part");
    if (open !== null) {
      expect(part, "a hit that starts in the folder ends in the name").toBe("end");
      hits.push(open + piece);
      open = null;
    } else if (part === "start") {
      open = piece;
    } else {
      expect(part, "a lone piece").toBeNull();
      hits.push(piece);
    }
  }
  expect(open, "no unfinished split hit").toBeNull();
  return hits;
}

const q = (searchQuery: string, currentMatchIndex = 0) => ({ searchQuery, isCurrentMatch: true, currentMatchIndex });

describe("PathText search marks (TR1a fix 2)", () => {
  it("marks a hit that spans the folder and the file name, split over both parts", () => {
    const { container } = render(<PathText path="/work/notebooks/report.ipynb" highlight={q("notebooks/report.ipynb")} />);
    const el = root(container);
    expect(el.textContent, "the shown text is unchanged").toBe("/work/notebooks/report.ipynb");
    expect(markedHits(el)).toEqual(["notebooks/report.ipynb"]);
    const dir = container.querySelector('[data-path-part="dir"]') as HTMLElement;
    const name = container.querySelector('[data-path-part="name"]') as HTMLElement;
    expect(dir.textContent).toBe("/work/notebooks/");
    expect(name.textContent).toBe("report.ipynb");
    expect([...dir.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["notebooks/"]);
    expect([...name.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["report.ipynb"]);
  });

  it("marks a spanning hit in a Windows path (backslash separators, case-insensitive)", () => {
    const { container } = render(<PathText path={"C:\\work\\Notebooks\\Report.ipynb"} highlight={q("notebooks\\report")} />);
    const el = root(container);
    expect(el.textContent).toBe("C:\\work\\Notebooks\\Report.ipynb");
    expect(markedHits(el)).toEqual(["Notebooks\\Report"]);
    expect(container.querySelector('[data-path-part="dir"] mark')?.textContent).toBe("Notebooks\\");
    expect(container.querySelector('[data-path-part="name"] mark')?.textContent).toBe("Report");
  });

  it("marks a spanning hit in a path shown relative to the project", () => {
    const { container } = render(<PathText path="/Users/jack/client/app/src/lib/a.ts" ctx={{ projectRoot: "/Users/jack/client/app" }} highlight={q("lib/a.t")} />);
    expect(root(container).textContent).toBe("src/lib/a.ts");
    expect(markedHits(root(container))).toEqual(["lib/a.t"]);
  });

  it("counts the hits over the whole shown path: the current match is the n-th of the path, not of each part", () => {
    const { container } = render(<PathText path="/x1/x1/x1" highlight={q("x1", 2)} />);
    const marks = [...container.querySelectorAll("mark")];
    expect(marks.map((m) => m.textContent)).toEqual(["x1", "x1", "x1"]);
    expect(marks.map((m) => m.getAttribute("data-search-highlight"))).toEqual([null, null, "current"]);
    expect(marks[2]?.closest('[data-path-part="name"]'), "the third hit is the file name").not.toBeNull();
  });

  it("gives a split current hit one scroll target, on its first piece", () => {
    const { container } = render(<PathText path="/work/notebooks/report.ipynb" highlight={q("s/r", 0)} />);
    const marks = [...container.querySelectorAll("mark")];
    expect(marks.map((m) => m.textContent)).toEqual(["s/", "r"]);
    expect(marks.map((m) => m.getAttribute("data-search-highlight"))).toEqual(["current", null]);
  });

  it("marks hits inside one part as before", () => {
    const { container } = render(<PathText path="/opt/deep/file-name.json" highlight={q("deep")} />);
    expect(markedHits(root(container))).toEqual(["deep"]);
    expect(container.querySelector('[data-path-part="dir"] mark')?.textContent).toBe("deep");
  });

  // The markup every existing caller gets (no highlight), captured from the
  // pre-fix component: it must stay byte-identical, also with an empty or
  // whitespace-only query.
  const NO_QUERY_MARKUP: [string, Record<string, string>, string][] = [
  ["/Users/jack/client/app/src/a.ts", {"projectRoot": "/Users/jack/client/app"}, "<span data-path=\"/Users/jack/client/app/src/a.ts\" data-path-kind=\"project\" data-mono=\"path\" title=\"/Users/jack/client/app/src/a.ts\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"dir\" class=\"min-w-0 max-w-full truncate\">src/</span><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">a.ts</span></span>"],
  ["/opt/some/deep/folder/file-name.json", {}, "<span data-path=\"/opt/some/deep/folder/file-name.json\" data-path-kind=\"absolute\" data-mono=\"path\" title=\"/opt/some/deep/folder/file-name.json\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"dir\" class=\"min-w-0 max-w-full truncate\">/opt/some/deep/folder/</span><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">file-name.json</span></span>"],
  ["/p/README.md", {"projectRoot": "/p"}, "<span data-path=\"/p/README.md\" data-path-kind=\"project\" data-mono=\"path\" title=\"/p/README.md\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">README.md</span></span>"],
  ["/home/me/proj/a.ts", {"homeDir": "/home/me"}, "<span data-path=\"/home/me/proj/a.ts\" data-path-kind=\"home\" data-mono=\"path\" title=\"/home/me/proj/a.ts\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"dir\" class=\"min-w-0 max-w-full truncate\">~/proj/</span><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">a.ts</span></span>"],
  ["C:\\work\\notebooks\\report.ipynb", {}, "<span data-path=\"C:\\work\\notebooks\\report.ipynb\" data-path-kind=\"absolute\" data-mono=\"path\" title=\"C:\\work\\notebooks\\report.ipynb\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"dir\" class=\"min-w-0 max-w-full truncate\">C:\\work\\notebooks\\</span><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">report.ipynb</span></span>"],
  ["C:\\Users\\me\\proj\\src\\main.rs", {"projectRoot": "C:\\Users\\me\\proj"}, "<span data-path=\"C:\\Users\\me\\proj\\src\\main.rs\" data-path-kind=\"project\" data-mono=\"path\" title=\"C:\\Users\\me\\proj\\src\\main.rs\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"dir\" class=\"min-w-0 max-w-full truncate\">src/</span><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">main.rs</span></span>"],
  ["/", {}, "<span data-path=\"/\" data-path-kind=\"absolute\" data-mono=\"path\" title=\"/\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">/</span></span>"],
  ["", {}, "<span data-path=\"\" data-path-kind=\"absolute\" data-mono=\"path\" title=\"\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\"></span></span>"],
  ["relative/only.txt", {}, "<span data-path=\"relative/only.txt\" data-path-kind=\"absolute\" data-mono=\"path\" title=\"relative/only.txt\" class=\"inline-flex min-w-0 max-w-full flex-wrap font-mono text-code text-fg\"><span data-path-part=\"dir\" class=\"min-w-0 max-w-full truncate\">relative/</span><span data-path-part=\"name\" class=\"min-w-0 max-w-full break-all\">only.txt</span></span>"],
  ];

  it.each(NO_QUERY_MARKUP)("no query: %s keeps its exact markup", (path, ctx, html) => {
    expect(renderToStaticMarkup(<PathText path={path} ctx={ctx} className="text-code text-fg" />)).toBe(html);
    expect(renderToStaticMarkup(<PathText path={path} ctx={ctx} className="text-code text-fg" highlight={q("")} />)).toBe(html);
    expect(renderToStaticMarkup(<PathText path={path} ctx={ctx} className="text-code text-fg" highlight={q("   ")} />)).toBe(html);
  });
});
