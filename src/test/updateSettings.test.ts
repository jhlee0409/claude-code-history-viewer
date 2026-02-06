import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from "vitest";

// Mock the logger
vi.mock("../utils/logger", () => ({
  updateLogger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getUpdateSettings,
  setUpdateSettings,
  shouldCheckForUpdates,
  shouldShowUpdateForVersion,
  skipVersion,
  postponeUpdate,
  isOnline,
} from "../utils/updateSettings";
import { DEFAULT_UPDATE_SETTINGS } from "../types/updateSettings";

// Mock localStorage if not available in the test environment
if (typeof localStorage === 'undefined') {
  (global as unknown as { localStorage: Storage }).localStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  };
}

describe("updateSettings", () => {
  const mockStorage: Record<string, string> = {};

  beforeAll(() => {
    // Force mock localStorage
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: vi.fn((key) => mockStorage[key] || null),
        setItem: vi.fn((key, value) => { mockStorage[key] = value.toString(); }),
        removeItem: vi.fn((key) => { delete mockStorage[key]; }),
        clear: vi.fn(() => { Object.keys(mockStorage).forEach(key => { delete mockStorage[key]; }); }),
        length: 0,
        key: vi.fn((i) => Object.keys(mockStorage)[i] || null),
      },
      writable: true
    });
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("getUpdateSettings", () => {
    it("should return default settings when no settings stored", () => {
      const settings = getUpdateSettings();
      expect(settings).toEqual(DEFAULT_UPDATE_SETTINGS);
    });

    it("should return stored settings merged with defaults", () => {
      const storedSettings = {
        autoCheck: false,
        checkInterval: "weekly" as const,
      };
      localStorage.setItem("update_settings", JSON.stringify(storedSettings));

      const settings = getUpdateSettings();
      expect(settings.autoCheck).toBe(false);
      expect(settings.checkInterval).toBe("weekly");
      // Other settings should be defaults
      expect(settings.skippedVersions).toEqual([]);
      expect(settings.hasSeenIntroduction).toBe(false);
    });

    it("should return defaults for invalid JSON", () => {
      localStorage.setItem("update_settings", "invalid json");
      const settings = getUpdateSettings();
      expect(settings).toEqual(DEFAULT_UPDATE_SETTINGS);
    });

    it("should ignore invalid checkInterval values", () => {
      const storedSettings = {
        checkInterval: "invalid",
      };
      localStorage.setItem("update_settings", JSON.stringify(storedSettings));

      const settings = getUpdateSettings();
      expect(settings.checkInterval).toBe(DEFAULT_UPDATE_SETTINGS.checkInterval);
    });

    it("should validate skippedVersions as string array", () => {
      const storedSettings = {
        skippedVersions: [1, 2, 3], // Invalid: numbers instead of strings
      };
      localStorage.setItem("update_settings", JSON.stringify(storedSettings));

      const settings = getUpdateSettings();
      expect(settings.skippedVersions).toEqual([]);
    });

    it("should accept valid skippedVersions array", () => {
      const storedSettings = {
        skippedVersions: ["1.0.0", "1.1.0"],
      };
      localStorage.setItem("update_settings", JSON.stringify(storedSettings));

      const settings = getUpdateSettings();
      expect(settings.skippedVersions).toEqual(["1.0.0", "1.1.0"]);
    });
  });

  describe("setUpdateSettings", () => {
    it("should merge with existing settings", () => {
      setUpdateSettings({ autoCheck: false });
      setUpdateSettings({ checkInterval: "daily" });

      const settings = getUpdateSettings();
      expect(settings.autoCheck).toBe(false);
      expect(settings.checkInterval).toBe("daily");
    });

    it("should persist to localStorage", () => {
      setUpdateSettings({ hasSeenIntroduction: true });

      const stored = localStorage.getItem("update_settings");
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.hasSeenIntroduction).toBe(true);
    });
  });

  describe("shouldCheckForUpdates", () => {
    it("should return false when autoCheck is disabled", () => {
      setUpdateSettings({ autoCheck: false });
      expect(shouldCheckForUpdates()).toBe(false);
    });

    it("should return false when checkInterval is never", () => {
      setUpdateSettings({ autoCheck: true, checkInterval: "never" });
      expect(shouldCheckForUpdates()).toBe(false);
    });

    it("should return true for startup interval", () => {
      setUpdateSettings({ autoCheck: true, checkInterval: "startup" });
      expect(shouldCheckForUpdates()).toBe(true);
    });

    it("should return false when within postpone interval", () => {
      setUpdateSettings({
        autoCheck: true,
        checkInterval: "startup",
        lastPostponedAt: Date.now(),
        postponeInterval: 24 * 60 * 60 * 1000, // 24 hours
      });
      expect(shouldCheckForUpdates()).toBe(false);
    });

    it("should return true when postpone interval has passed", () => {
      setUpdateSettings({
        autoCheck: true,
        checkInterval: "startup",
        lastPostponedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        postponeInterval: 24 * 60 * 60 * 1000, // 24 hours
      });
      expect(shouldCheckForUpdates()).toBe(true);
    });
  });

  describe("shouldShowUpdateForVersion", () => {
    it("should return true for non-skipped version", () => {
      setUpdateSettings({ skippedVersions: ["1.0.0"] });
      expect(shouldShowUpdateForVersion("1.1.0")).toBe(true);
    });

    it("should return false for skipped version", () => {
      setUpdateSettings({ skippedVersions: ["1.0.0", "1.1.0"] });
      expect(shouldShowUpdateForVersion("1.1.0")).toBe(false);
    });
  });

  describe("skipVersion", () => {
    it("should add version to skipped list", () => {
      skipVersion("1.0.0");
      const settings = getUpdateSettings();
      expect(settings.skippedVersions).toContain("1.0.0");
    });

    it("should not add duplicate version", () => {
      skipVersion("1.0.0");
      skipVersion("1.0.0");
      const settings = getUpdateSettings();
      expect(settings.skippedVersions.filter((v) => v === "1.0.0")).toHaveLength(1);
    });

    it("should preserve existing skipped versions", () => {
      setUpdateSettings({ skippedVersions: ["1.0.0"] });
      skipVersion("1.1.0");
      const settings = getUpdateSettings();
      expect(settings.skippedVersions).toEqual(["1.0.0", "1.1.0"]);
    });
  });

  describe("postponeUpdate", () => {
    it("should set lastPostponedAt to current time", () => {
      const before = Date.now();
      postponeUpdate();
      const after = Date.now();

      const settings = getUpdateSettings();
      expect(settings.lastPostponedAt).toBeGreaterThanOrEqual(before);
      expect(settings.lastPostponedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("isOnline", () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        writable: true,
      });
    });

    it("should return navigator.onLine value", () => {
      Object.defineProperty(global, "navigator", {
        value: { onLine: true },
        writable: true,
      });
      expect(isOnline()).toBe(true);

      Object.defineProperty(global, "navigator", {
        value: { onLine: false },
        writable: true,
      });
      expect(isOnline()).toBe(false);
    });
  });
});
