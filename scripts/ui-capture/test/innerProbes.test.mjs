// Inner-UI probes (plan I0): what each probe counts on a small fake page,
// and the population contract (applicable + nothing judged = failure).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import {
  PROBE_APPLICABILITY,
  cjkLanguage,
  findAbsolutePaths,
  populationFailures,
  runInnerProbes,
  staticProbeSource,
} from "../lib/innerProbes.mjs";
import { browserRequirement } from "./requirements.mjs";

describe("findAbsolutePaths", () => {
  it("finds POSIX system roots, drive letters, UNC and \\\\?\\ paths", () => {
    expect(findAbsolutePaths("edited /Users/jack/work/app/src/index.ts today")).toEqual(["/Users/jack/work/app/src/index.ts"]);
    expect(findAbsolutePaths("/opt/app/bin/run")).toEqual(["/opt/app/bin/run"]);
    expect(findAbsolutePaths("at C:\\Users\\jack\\app\\main.rs")).toEqual(["C:\\Users\\jack\\app\\main.rs"]);
    expect(findAbsolutePaths("share \\\\server\\team\\notes.md")).toEqual(["\\\\server\\team\\notes.md"]);
    expect(findAbsolutePaths("\\\\?\\C:\\very\\long")).toEqual(["\\\\?\\C:\\very\\long"]);
    expect(findAbsolutePaths("wsl /mnt/c/Users/jack")).toEqual(["/mnt/c/Users/jack"]);
  });

  it("does not take relative paths, URLs or API routes for absolute paths", () => {
    expect(findAbsolutePaths("src/components/App.tsx")).toEqual([]);
    expect(findAbsolutePaths("Paginate the /v2/events endpoint")).toEqual([]);
    expect(findAbsolutePaths("https://example.com/Users/x")).toEqual([]);
    expect(findAbsolutePaths("~/work/app")).toEqual([]);
  });
});

describe("cjkLanguage", () => {
  it("tells Korean, Japanese and Chinese apart, using lang for Han-only text", () => {
    expect(cjkLanguage("세션 목록")).toBe("ko");
    expect(cjkLanguage("セッション一覧")).toBe("ja");
    expect(cjkLanguage("会话列表")).toBe("zh");
    expect(cjkLanguage("一覧", "ja")).toBe("ja");
    expect(cjkLanguage("plain text")).toBe(null);
  });
});

describe("population contract", () => {
  it("fails an applicable probe that judged nothing, and only that one", () => {
    const failures = populationFailures({
      absPathLeaks: { applicable: true, population: 0, selector: "body" },
      cards: { applicable: true, population: 12, selector: "main *" },
      motionActivity: { applicable: false, population: null, selector: null },
    });
    expect(failures).toEqual(["absPathLeaks: empty population (body)"]);
  });

  it("declares where each probe applies", () => {
    const ctx = { screen: "transcript", locale: "en", mobile: false, theme: "dark", viewport: "1440x900", live: false };
    expect(PROBE_APPLICABILITY.absPathLeaks(ctx)).toBe(true);
    expect(PROBE_APPLICABILITY.absPathLeaks({ ...ctx, screen: "home" })).toBe(false);
    expect(PROBE_APPLICABILITY.motionActivity(ctx)).toBe(false);
    expect(PROBE_APPLICABILITY.motionActivity({ ...ctx, live: true })).toBe(true);
    expect(PROBE_APPLICABILITY.wordBreak({ ...ctx, locale: "ko" })).toBe(true);
    expect(PROBE_APPLICABILITY.chromeSelect({ ...ctx, mobile: true })).toBe(false);
  });
});

const req = browserRequirement({ webkit: true });

const page = (body) => `<!doctype html><html lang="en"><body style="margin:0;font:16px sans-serif">${body}</body></html>`;

describe.skipIf(!req.enabled)("probes on a fake page (real WebKit)", () => {
  let browser;
  beforeAll(async () => {
    browser = await webkit.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  async function run(name, body) {
    const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
    try {
      await p.setContent(page(body));
      return await p.evaluate(staticProbeSource(name));
    } finally {
      await p.close();
    }
  }

  it("absPathLeaks: one leaked path → 1", async () => {
    const r = await run("absPathLeaks", `<main data-slot="main"><div>Edit /Users/jack/work/app/src/index.ts</div></main>`);
    expect(r.value.leaks).toBe(1);
    expect(r.population).toBe(1);
  });

  it("absPathLeaks: a path only in title / aria-label → 0", async () => {
    const r = await run("absPathLeaks", `<div title="/Users/jack/work/app/src/index.ts" aria-label="/Users/jack/a/b">index.ts</div>`);
    expect(r.value.leaks).toBe(0);
    expect(r.population).toBe(1);
  });

  it("absPathLeaks: C:\\, UNC and /opt each count 1", async () => {
    for (const text of ["C:\\Users\\jack\\app\\main.rs", "\\\\server\\team\\notes.md", "/opt/app/bin/run"]) {
      const r = await run("absPathLeaks", `<span>${text}</span>`);
      expect(r.value.leaks, text).toBe(1);
    }
  });

  it("absPathLeaks: a path inside an output well or code → 0", async () => {
    const r = await run(
      "absPathLeaks",
      `<p>Result</p><div data-output><span>/Users/jack/work/app/out.log</span></div><pre>/home/ci/build.log</pre><code>/opt/x/y</code>`,
    );
    expect(r.value.leaks).toBe(0);
    expect(r.population).toBe(1); // only "Result" is path UI
  });

  it("absPathLeaks: a justified absolute path (data-path-kind=absolute) → 0", async () => {
    const r = await run("absPathLeaks", `<span data-path-kind="absolute">/Users/jack/elsewhere/file.txt</span><span>ok</span>`);
    expect(r.value.leaks).toBe(0);
  });

  it("absPathLeaks: nothing visible → population 0 (fails where the probe applies)", async () => {
    const r = await run("absPathLeaks", `<div hidden>/Users/jack/a/b</div>`);
    expect(r.population).toBe(0);
    expect(populationFailures({ absPathLeaks: { applicable: true, ...r } })).toHaveLength(1);
  });

  it("wordBreak: counts keep-all per language", async () => {
    const r = await run(
      "wordBreak",
      `<p style="word-break:keep-all">세션 목록</p><p>설정 화면</p><p lang="ja">セッション</p><p>English only</p>`,
    );
    expect(r.population).toBe(3);
    expect(r.value.byLang.ko).toMatchObject({ total: 2, keepAll: 1 });
    expect(r.value.byLang.ja).toMatchObject({ total: 1, keepAll: 0 });
  });

  it("cjkLeading: a multi-line CJK paragraph below 1.5 line height counts", async () => {
    const long = "세션 목록 정렬 기준을 마지막 활동 시간으로 바꿔줘 ".repeat(8);
    const r = await run("cjkLeading", `<p style="width:200px;line-height:1.4">${long}</p><p style="width:200px;line-height:1.7">${long}</p><p>한 줄</p>`);
    expect(r.population).toBe(2);
    expect(r.value.below15).toBe(1);
  });

  it("cjkLeading: a one-line CJK run inside a wrapped paragraph counts (Korean keep-all)", async () => {
    const code = "<code>a-very-long-identifier-that-takes-a-whole-line</code>";
    const r = await run("cjkLeading", `<p style="width:200px;line-height:1.4;word-break:keep-all">짧은 문장 ${code} 끝</p><p>한 줄</p>`);
    expect(r.population).toBe(2);
    expect(r.value.below15).toBe(2);
  });

  it("overflowX: a clipped box counts, a scroller and an ellipsis do not", async () => {
    const r = await run(
      "overflowX",
      `<div style="width:100px;overflow:hidden;white-space:nowrap">${"x".repeat(80)}</div>
       <div style="width:100px;overflow:auto;white-space:nowrap">${"y".repeat(80)}</div>
       <div style="width:100px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${"z".repeat(80)}</div>`,
    );
    expect(r.value.clipped).toBe(1);
  });

  it("cards: counts bordered rounded boxes and their nesting", async () => {
    const card = (inner) => `<div style="border:1px solid #888;border-radius:8px;padding:12px;min-width:60px;min-height:30px">${inner}</div>`;
    const pill = `<div style="border:1px solid #888;border-radius:9999px;width:80px;height:30px">pill</div>`;
    const r = await run("cards", `<main data-slot="main">${card(card("inner"))}${card("other")}${pill}<div style="border:1px solid #888;min-height:30px">square</div></main>`);
    expect(r.value.cards).toBe(4);
    expect(r.value.maxNesting).toBe(2);
    expect(r.value.radii).toEqual({ 8: 3, pill: 1 });
  });

  // D20: "PageHeader title x == first content column x" — the header's own
  // subtitle is not content (review R2: a subtitle aligned with the title made
  // every screen read 0 while the Edits file names sat 50px to the right).
  const header = (title, sub) =>
    `<div id="hdr" style="padding:12px 28px;display:flex;gap:12px"><div style="width:36px;height:36px"></div><div><h2 style="margin:0">${title}</h2><p style="margin:0">${sub}</p></div></div>`;
  const runLeft = async (body, screen = "analytics") => {
    const p = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    try {
      await p.setContent(page(`<main data-slot="main">${body}</main>`));
      return await p.evaluate(staticProbeSource("leftEdges", { screen }));
    } finally {
      await p.close();
    }
  };

  it("leftEdges: the header subtitle is not the content column (title/subtitle 76, body 208 → +132)", async () => {
    const r = await runLeft(`${header("Analytics", "Overview of the project")}<section style="padding-left:208px"><p style="margin:0">Total tokens</p></section>`);
    expect(r.value.headingX).toBe(76);
    expect(r.value.contentX).toBe(208);
    expect(r.value.delta).toBe(132);
    expect(r.value.contentRule).toBe("leftmostBody");
  });

  it("leftEdges: header and body in one wrapper — the title block (title + subtitle) is still the header", async () => {
    const r = await runLeft(`<div>${header("Analytics", "Overview")}<p style="margin:0;padding-left:150px">Body</p></div>`);
    expect(r.value.contentX).toBe(150);
    expect(r.value.delta).toBe(74);
  });

  it("leftEdges: controls (tabs, buttons) are not the content column; the leftmost body text is", async () => {
    const r = await runLeft(
      `${header("Analytics", "sub")}<div role="tablist" style="padding-left:40px"><button role="tab">Overview</button></div>
       <div style="position:relative;height:80px"><span style="position:absolute;left:300px;top:0">62x</span><p style="position:absolute;left:100px;top:20px;margin:0">1.4K</p></div>`,
    );
    expect(r.value.contentX).toBe(100);
    expect(r.value.delta).toBe(24);
  });

  it("leftEdges: on Edits the content column is the file name column, not the summary line", async () => {
    const body = `${header("Recent edits", "Check the latest content")}
      <p style="margin:0;padding-left:28px">10 files, 188 edits</p>
      <div style="display:flex;padding-left:28px;gap:26px"><div style="width:24px"></div><div><div>Sidebar.tsx</div><div>src/components</div></div></div>`;
    const edits = await runLeft(body, "recent-edits");
    expect(edits.value.contentRule).toBe("fileName");
    expect(edits.value.contentX).toBe(78);
    expect(edits.value.delta).toBe(2);
    const compact = await runLeft(body, "recent-edits-compact");
    expect(compact.value.contentRule).toBe("fileName");
  });

  it("chromeSelect: selectable chrome text counts, user-select:none does not", async () => {
    const r = await run("chromeSelect", `<header><span>Title</span><span style="-webkit-user-select:none;user-select:none">Tabs</span></header><main>body</main>`);
    expect(r.population).toBe(2);
    expect(r.value.selectable).toBe(1);
  });

  it("toolRowMetrics: rows from the fallback selector, font size and height", async () => {
    const r = await run(
      "toolRowMetrics",
      `<div data-message-uuid="u1"><button aria-expanded="false" style="font-size:12px;height:28px">Read index.ts</button></div>
       <div data-tool-row style="height:32px"><span style="font-size:13px">Bash</span></div>`,
    );
    expect(r.population).toBe(2);
    expect(r.value.fontSizes).toEqual({ 12: 1, 13: 1 });
    expect(r.value.minHeight).toBe(28);
  });

  it("focusVisible: a stop with no ring is invisible, one with an outline is visible", async () => {
    const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
    try {
      await p.setContent(
        page(`<style>button{font:14px sans-serif;padding:6px;margin:12px;border:0;background:#ddd}
          #ring:focus-visible{outline:3px solid #1463ff;outline-offset:2px}
          #flat:focus{outline:none}</style>
          <button id="flat">No ring</button><button id="ring">Ring</button>`),
      );
      const results = await runInnerProbes(p, { screen: "home", locale: "en", mobile: false, theme: "dark", viewport: "1440x900", live: false }, { only: ["focusVisible"] });
      expect(results.focusVisible.population).toBe(2);
      expect(results.focusVisible.value.visible).toBe(1);
      expect(results.focusVisible.value.invisible).toBe(1);
    } finally {
      await p.close();
    }
  }, 30_000);
});
