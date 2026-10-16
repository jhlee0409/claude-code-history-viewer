// Step implementations for scenarios.mjs. Selectors prefer stable hooks
// (ids, data-tree-node / data-project-path, data-slot) and localized
// accessible names read from the captured build's own locale files; they
// never depend on CSS classes. Every step parks the pointer and settles.

import { parkPointer, settle } from "./browser.mjs";

const VIEW_LABEL_KEYS = {
  messages: "message.view",
  analytics: "analytics.dashboard",
  tokenStats: "messages.tokenStats.existing",
  recentEdits: "recentEdits.title",
  board: "session.board.title",
};

const MOBILE_TAB_KEYS = {
  projects: "common.mobile.tab.projects",
  messages: "common.mobile.tab.messages",
  board: "common.mobile.tab.board",
  analytics: "common.mobile.tab.analytics",
  settings: "common.mobile.tab.settings",
};

const MENU_LABEL_KEYS = {
  settingsManager: "settingsManager.title",
  archive: "archive.title",
};

/** Library sections that expand in place (T7 sidebar). */
const LIBRARY_LISTS = new Set(["recent", "favorites"]);

const cssString = (value) => JSON.stringify(value);

export function createActions({ session, scenario, manifest, t }) {
  const { page } = session;
  const mobile = scenario.mobile;

  const project = (key) => {
    const found = key === "featured" ? manifest.projects[0] : manifest.projects.find((p) => p.name === key);
    if (!found) throw new Error(`unknown fixture project "${key}"`);
    return found;
  };
  const fixtureSession = (key) => {
    const found = key === "large" ? manifest.largeSession : key === "subagent" ? manifest.subagentSession : null;
    if (!found) throw new Error(`unknown fixture session "${key}"`);
    return found;
  };

  const settled = (label) => settle(session, { label });
  const click = async (locator, label, options = {}) => {
    try {
      await locator.scrollIntoViewIfNeeded();
      await locator.click(options);
    } catch (error) {
      // Name the step: a bare locator timeout does not say which one.
      throw new Error(`${label}: ${String(error?.message ?? error).split("\n")[0]}`);
    }
    await parkPointer(page);
    await settled(label);
  };

  // The tab bar is the navigation landmark that holds the tabs. Found by its
  // tabs, not by its own label: that label is translated, and a base build
  // older than the translation has no key for it.
  const tabButton = (key) => page.getByRole("button", { name: t(MOBILE_TAB_KEYS[key]), exact: true });
  const mobileTab = (key) =>
    page
      .getByRole("navigation")
      .filter({ has: tabButton("projects") })
      .filter({ has: tabButton("settings") })
      .getByRole("button", { name: t(MOBILE_TAB_KEYS[key]), exact: true });

  const drawerOpen = async () => (await page.getByRole("dialog").count()) > 0;

  // On mobile the project tree lives in a modal drawer: while it is open the
  // rest of the app is inert (aria-hidden + pointer-events: none), so every
  // drawer step closes it again, as a user would before using the tab bar or
  // the header menu.
  const closeDrawer = async () => {
    if (!mobile || !(await drawerOpen())) return;
    await page.keyboard.press("Escape");
    await parkPointer(page);
    await settled("close drawer");
  };

  const selectProjectRow = async (target) => {
    const row = page.locator(`[data-tree-node="project"][data-project-path=${cssString(target.appPath)}]`).first();
    if ((await row.getAttribute("aria-selected")) === "true") return;
    await click(row, `project ${target.name}`);
  };

  const projectRows = page.locator('[data-tree-node="project"]');
  const projectState = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-tree-node="project"]')];
      return {
        expanded: rows.filter((row) => row.getAttribute("aria-expanded") === "true").length,
        selected: rows.filter((row) => row.getAttribute("aria-selected") === "true").length,
        pane: document.getElementById("sessions-pane") !== null,
      };
    });

  const steps = {
    async collapseProjects() {
      await steps.openSidebar();
      // The tree's own keyboard contract: ArrowLeft collapses an expanded row.
      for (let guard = 0; guard < 50; guard += 1) {
        const open = projectRows.and(page.locator('[aria-expanded="true"]')).first();
        if ((await open.count()) === 0) break;
        await open.focus();
        await page.keyboard.press("ArrowLeft");
        await settled("collapse project");
      }
      const state = await projectState();
      if (state.expanded !== 0 || state.selected !== 0) {
        throw new Error(`collapseProjects: ${state.expanded} expanded / ${state.selected} selected project rows remain`);
      }
    },

    async expandProject({ project: key }) {
      const target = project(key);
      await steps.openSidebar();
      await selectProjectRow(target);
      const row = page.locator(`[data-tree-node="project"][data-project-path=${cssString(target.appPath)}]`).first();
      if ((await row.getAttribute("aria-expanded")) === "false") {
        await row.focus();
        await page.keyboard.press("ArrowRight");
        await settled(`expand ${target.name}`);
      }
      await parkPointer(page);
      // One project open: inline (aria-expanded) or, where the layout shows
      // sessions in the sessions pane, the selected project's pane.
      const state = await projectState();
      const inlineOpen = state.expanded === 1 && (await row.getAttribute("aria-expanded")) === "true";
      const paneOpen = state.pane && state.expanded === 0 && state.selected === 1;
      if (!inlineOpen && !paneOpen) {
        throw new Error(`expandProject ${target.name}: ${JSON.stringify(state)} is not exactly one open project`);
      }
    },

    async openSidebar() {
      if (!mobile) return;
      if (await drawerOpen()) return;
      await click(mobileTab("projects"), "open drawer");
    },

    async openProject({ project: key }) {
      await steps.openSidebar();
      await selectProjectRow(project(key));
      await closeDrawer();
    },

    async openSession({ session: key }) {
      const target = fixtureSession(key);
      await steps.openSidebar();
      await selectProjectRow(project(target.project));
      const pane = page.locator("#sessions-pane");
      const scope = mobile ? page.getByRole("dialog") : (await pane.count()) > 0 ? pane : page.getByRole("tree");
      await click(scope.getByText(target.title.slice(0, 40)).first(), `session ${target.title}`);
      await closeDrawer();
    },

    async view({ view }) {
      if (!(view in VIEW_LABEL_KEYS)) throw new Error(`unknown view "${view}"`);
      if (!mobile) {
        // View tabs are role=tab in a tablist since T2; base builds before it
        // render them as buttons in a group, and both must be drivable.
        const header = page.locator("#app-header");
        const tabNamed = (name) =>
          header
            .locator("[role=tablist]")
            .getByRole("tab", { name, exact: true })
            .or(header.locator("[role=group]").getByRole("button", { name, exact: true }));
        const tab = tabNamed(t(VIEW_LABEL_KEYS[view]));
        // Since T7 token stats has no tab: it opens from the analytics
        // screen's header (plan C1). Builds before T7 still have the tab.
        if (view === "tokenStats" && (await tab.count()) === 0) {
          await click(tabNamed(t(VIEW_LABEL_KEYS.analytics)), "view analytics");
          await click(page.locator('[data-related-view="tokenStats"]'), "view tokenStats");
          return;
        }
        await click(tab, `view ${view}`);
        return;
      }
      if (view === "tokenStats" || view === "recentEdits") {
        // Mobile reaches these through the analytics sub-navigation inside
        // the main pane (#main-content predates the capture markers, so base
        // builds without data-slot="main" are driven the same way).
        await click(mobileTab("analytics"), "view analytics");
        const label = view === "tokenStats" ? t("messages.tokenStats.title") : t("recentEdits.title");
        await click(page.locator("#main-content").getByRole("button", { name: label, exact: true }), `view ${view}`);
        return;
      }
      await click(mobileTab(view), `view ${view}`);
    },

    /**
     * An app-level tool (Settings Manager, Archive). Since T7 it is a sidebar
     * library row (in the drawer on mobile); builds before T7 have it in the
     * gear menu, so that path stays as the fallback.
     */
    async appMenu({ item }) {
      if (!(item in MENU_LABEL_KEYS)) throw new Error(`unknown app menu item "${item}"`);
      await steps.openSidebar();
      const row = page.locator(`[data-library-item="${item}"]`).first();
      if ((await row.count()) > 0) {
        await click(row, `library ${item}`);
        await closeDrawer();
        return;
      }
      await closeDrawer();
      await click(page.locator("#app-settings-button"), "open app menu");
      await click(page.getByRole("menuitem", { name: t(MENU_LABEL_KEYS[item]) }), `menu ${item}`);
    },

    /** Expand a library list in the sidebar ("recent" | "favorites"). T7 and later. */
    async libraryList({ list }) {
      if (!LIBRARY_LISTS.has(list)) throw new Error(`unknown library list "${list}"`);
      await steps.openSidebar();
      const row = page.locator(`[data-library-item="${list}"]`).first();
      if ((await row.getAttribute("aria-expanded")) !== "true") await click(row, `library ${list}`);
    },

    /** Star a fixture session through its row's context menu (T7 and later). */
    async favorite({ session: key, off = false }) {
      const target = fixtureSession(key);
      await steps.openSidebar();
      await selectProjectRow(project(target.project));
      const row = page.getByRole("tree").getByText(target.title.slice(0, 40)).first();
      await row.scrollIntoViewIfNeeded();
      await row.click({ button: "right" });
      await settled("session menu");
      const label = t(off ? "session.favorite.remove" : "session.favorite.add");
      await click(page.getByRole("menuitem", { name: label, exact: true }), `${off ? "unfavorite" : "favorite"} ${key}`);
      await closeDrawer();
    },

    /**
     * Multi-select mode on the open project's sessions: the "Select" button,
     * then `count` rows checked (decision (나): ⌘+click no longer selects).
     */
    async selectSessions({ project: key, count }) {
      const target = project(key);
      await steps.openSidebar();
      await selectProjectRow(target);
      const enter = page.getByRole("button", { name: t("session.selection.enter"), exact: true }).first();
      await click(enter, "enter selection mode");
      const titles = target.sessions.map((s) => s.title).slice(0, count);
      const pane = page.locator("#sessions-pane");
      const scope = mobile ? page.getByRole("dialog") : (await pane.count()) > 0 ? pane : page.getByRole("tree");
      for (const title of titles) {
        await click(scope.getByText(title.slice(0, 40)).first(), `check ${title}`);
      }
    },

    /**
     * The app's font-size setting through its own menu (gear → font size →
     * N%), by keyboard: Radix opens a submenu on hover only after a timer and
     * closes it when the pointer crosses other items, so pointer driving is
     * fragile under the paused clock.
     */
    async fontScale({ percent }) {
      await click(page.locator("#app-settings-button"), "open app menu");
      // The trigger reads "<title> · <current>%": match the title as a substring.
      await page.getByRole("menuitem", { name: t("common.settings.font.title") }).press("ArrowRight");
      await settled("open font submenu");
      const option = page.getByRole("menuitemradio", { name: `${t(`common.settings.font.${percent}`)} (${percent}%)`, exact: true });
      await option.press("Enter");
      await parkPointer(page);
      await settled(`font scale ${percent}%`);
      if ((await page.getByRole("menu").count()) > 0) {
        await page.keyboard.press("Escape");
        await settled("close app menu");
      }
    },

    /**
     * Conversation tabs (T8). ⌘+click (Ctrl+click off macOS) on a session row
     * of a fixture project opens it in a new tab. `session` is "large" |
     * "subagent", or `project` + `index` into that project's sessions.
     */
    async openSessionInNewTab({ session: key, project: projectKey = "featured", index = 0 }) {
      const target = key ? fixtureSession(key) : { project: project(projectKey).name, title: project(projectKey).sessions[index].title };
      if (mobile) throw new Error("openSessionInNewTab: no ⌘+click on a phone; use newTab + openSession");
      await selectProjectRow(project(target.project));
      await click(page.getByRole("tree").getByText(target.title.slice(0, 40)).first(), `session ${target.title} in a new tab`, {
        modifiers: ["ControlOrMeta"],
      });
    },

    /** ⌘+click on a toolbar screen tab: that screen in a new tab (desktop). */
    async viewInNewTab({ view }) {
      if (!(view in VIEW_LABEL_KEYS)) throw new Error(`unknown view "${view}"`);
      const tab = page.locator("#app-header [role=tablist]").getByRole("tab", { name: t(VIEW_LABEL_KEYS[view]), exact: true });
      await click(tab, `view ${view} in a new tab`, { modifiers: ["ControlOrMeta"] });
    },

    /** A new empty tab: the strip's + (desktop) or the tab sheet's button (phone). */
    async newTab() {
      if (mobile) {
        await steps.tabSheet();
        await click(page.getByRole("dialog").getByRole("button", { name: t("common.command.newTab"), exact: true }), "new tab");
        return;
      }
      await click(page.locator('[data-slot="tabs"]').getByRole("button", { name: t("common.command.newTab"), exact: true }), "new tab");
    },

    /** Open the tab at `index` (0-based): from the strip, or the phone's tab sheet. */
    async selectTab({ index }) {
      if (mobile) {
        await steps.tabSheet();
        await click(page.getByRole("dialog").locator("li").nth(index).locator("button").first(), `tab ${index}`);
        return;
      }
      // A tab scrolled half out of the strip: WebKit's scrollIntoViewIfNeeded
      // leaves it there, and under the paused clock hit testing keeps the old
      // scroll position until the next rendering update. Scroll it into view
      // and click it as the DOM element (no hit test, no focus ring).
      const tab = page.locator('[data-slot="tabs"] [role="tab"]').nth(index);
      await tab.evaluate((el) => {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        el.click();
      });
      await parkPointer(page);
      await settled(`tab ${index}`);
    },

    /** The phone toolbar's tab count: opens the list of tabs. */
    async tabSheet() {
      if (!mobile) throw new Error("tabSheet: phones only");
      if (await drawerOpen()) return;
      await click(page.locator("[data-mobile-tabs]"), "tab sheet");
    },

    async globalStats() {
      await steps.openSidebar();
      await click(page.locator('[data-tree-node="global"]').first(), "global stats");
      await closeDrawer();
    },
  };

  return async function run(step) {
    const fn = steps[step.do];
    if (!fn) throw new Error(`unknown step "${step.do}"`);
    await fn(step);
  };
}
