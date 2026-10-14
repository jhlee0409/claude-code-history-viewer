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
  const click = async (locator, label) => {
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    await parkPointer(page);
    await settled(label);
  };

  const mobileTab = (key) =>
    page.locator('nav[aria-label="Navigation"]').getByRole("button", { name: t(MOBILE_TAB_KEYS[key]), exact: true });

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
        const group = page.locator("#app-header [role=group]");
        await click(group.getByRole("button", { name: t(VIEW_LABEL_KEYS[view]), exact: true }), `view ${view}`);
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

    async appMenu({ item }) {
      if (!(item in MENU_LABEL_KEYS)) throw new Error(`unknown app menu item "${item}"`);
      await click(page.locator("#app-settings-button"), "open app menu");
      await click(page.getByRole("menuitem", { name: t(MENU_LABEL_KEYS[item]) }), `menu ${item}`);
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
