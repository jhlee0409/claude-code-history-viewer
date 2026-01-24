/**
 * Tests for metadata.types.ts
 *
 * Tests helper functions for session and project metadata.
 */

import { describe, it, expect } from "vitest";
import {
  METADATA_SCHEMA_VERSION,
  DEFAULT_USER_METADATA,
  isSessionMetadataEmpty,
  isProjectMetadataEmpty,
  getSessionDisplayName,
  isProjectHidden,
  type SessionMetadata,
  type ProjectMetadata,
  type UserMetadata,
} from "../types/metadata.types";

// ============================================================================
// Constants Tests
// ============================================================================

describe("METADATA_SCHEMA_VERSION", () => {
  it("should be version 1", () => {
    expect(METADATA_SCHEMA_VERSION).toBe(1);
  });
});

describe("DEFAULT_USER_METADATA", () => {
  it("should have correct initial structure", () => {
    expect(DEFAULT_USER_METADATA).toEqual({
      version: 1,
      sessions: {},
      projects: {},
      settings: {},
    });
  });

  it("should have empty sessions object", () => {
    expect(DEFAULT_USER_METADATA.sessions).toEqual({});
    expect(Object.keys(DEFAULT_USER_METADATA.sessions)).toHaveLength(0);
  });

  it("should have empty projects object", () => {
    expect(DEFAULT_USER_METADATA.projects).toEqual({});
    expect(Object.keys(DEFAULT_USER_METADATA.projects)).toHaveLength(0);
  });

  it("should have empty settings object", () => {
    expect(DEFAULT_USER_METADATA.settings).toEqual({});
  });
});

// ============================================================================
// isSessionMetadataEmpty Tests
// ============================================================================

describe("isSessionMetadataEmpty", () => {
  it("should return true for completely empty metadata", () => {
    const metadata: SessionMetadata = {};
    expect(isSessionMetadataEmpty(metadata)).toBe(true);
  });

  it("should return true for metadata with all undefined fields", () => {
    const metadata: SessionMetadata = {
      customName: undefined,
      starred: undefined,
      tags: undefined,
      notes: undefined,
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(true);
  });

  it("should return true for metadata with empty tags array", () => {
    const metadata: SessionMetadata = {
      tags: [],
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(true);
  });

  it("should return false when customName is set", () => {
    const metadata: SessionMetadata = {
      customName: "My Session",
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(false);
  });

  it("should return false when starred is true", () => {
    const metadata: SessionMetadata = {
      starred: true,
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(false);
  });

  it("should return true when starred is false", () => {
    const metadata: SessionMetadata = {
      starred: false,
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(true);
  });

  it("should return false when tags has items", () => {
    const metadata: SessionMetadata = {
      tags: ["important", "todo"],
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(false);
  });

  it("should return false when notes is set", () => {
    const metadata: SessionMetadata = {
      notes: "Some notes here",
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(false);
  });

  it("should return false when multiple fields are set", () => {
    const metadata: SessionMetadata = {
      customName: "Test",
      starred: true,
      tags: ["tag1"],
      notes: "Notes",
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(false);
  });

  // Edge cases
  it("should return true for empty string customName", () => {
    const metadata: SessionMetadata = {
      customName: "",
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(true);
  });

  it("should return true for empty string notes", () => {
    const metadata: SessionMetadata = {
      notes: "",
    };
    expect(isSessionMetadataEmpty(metadata)).toBe(true);
  });
});

// ============================================================================
// isProjectMetadataEmpty Tests
// ============================================================================

describe("isProjectMetadataEmpty", () => {
  it("should return true for completely empty metadata", () => {
    const metadata: ProjectMetadata = {};
    expect(isProjectMetadataEmpty(metadata)).toBe(true);
  });

  it("should return true for metadata with all undefined fields", () => {
    const metadata: ProjectMetadata = {
      hidden: undefined,
      alias: undefined,
      parentProject: undefined,
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(true);
  });

  it("should return false when hidden is true", () => {
    const metadata: ProjectMetadata = {
      hidden: true,
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(false);
  });

  it("should return true when hidden is false", () => {
    const metadata: ProjectMetadata = {
      hidden: false,
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(true);
  });

  it("should return false when alias is set", () => {
    const metadata: ProjectMetadata = {
      alias: "My Project",
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(false);
  });

  it("should return false when parentProject is set", () => {
    const metadata: ProjectMetadata = {
      parentProject: "/path/to/parent",
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(false);
  });

  it("should return false when multiple fields are set", () => {
    const metadata: ProjectMetadata = {
      hidden: true,
      alias: "Alias",
      parentProject: "/parent",
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(false);
  });

  // Edge cases
  it("should return true for empty string alias", () => {
    const metadata: ProjectMetadata = {
      alias: "",
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(true);
  });

  it("should return true for empty string parentProject", () => {
    const metadata: ProjectMetadata = {
      parentProject: "",
    };
    expect(isProjectMetadataEmpty(metadata)).toBe(true);
  });
});

// ============================================================================
// getSessionDisplayName Tests
// ============================================================================

describe("getSessionDisplayName", () => {
  it("should return undefined when metadata is null", () => {
    expect(getSessionDisplayName(null, "session-1")).toBeUndefined();
  });

  it("should return fallback when metadata is null and fallback is provided", () => {
    const result = getSessionDisplayName(null, "session-1", "Fallback");
    expect(result).toBe("Fallback");
  });

  it("should return undefined when session has no metadata", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {},
      projects: {},
      settings: {},
    };
    expect(getSessionDisplayName(metadata, "nonexistent")).toBeUndefined();
  });

  it("should return fallback when session has no metadata", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {},
      projects: {},
      settings: {},
    };
    const result = getSessionDisplayName(metadata, "session-1", "My Fallback");
    expect(result).toBe("My Fallback");
  });

  it("should return customName when set", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {
        "session-1": { customName: "Custom Name" },
      },
      projects: {},
      settings: {},
    };
    expect(getSessionDisplayName(metadata, "session-1")).toBe("Custom Name");
  });

  it("should return customName over fallback", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {
        "session-1": { customName: "Custom Name" },
      },
      projects: {},
      settings: {},
    };
    const result = getSessionDisplayName(metadata, "session-1", "Fallback");
    expect(result).toBe("Custom Name");
  });

  it("should return fallback when customName is not set", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {
        "session-1": { starred: true }, // No customName
      },
      projects: {},
      settings: {},
    };
    const result = getSessionDisplayName(metadata, "session-1", "Fallback");
    expect(result).toBe("Fallback");
  });

  it("should return fallback when customName is empty string", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {
        "session-1": { customName: "" },
      },
      projects: {},
      settings: {},
    };
    const result = getSessionDisplayName(metadata, "session-1", "Fallback");
    expect(result).toBe("Fallback");
  });
});

// ============================================================================
// isProjectHidden Tests
// ============================================================================

describe("isProjectHidden", () => {
  it("should return false when metadata is null", () => {
    expect(isProjectHidden(null, "/path/to/project")).toBe(false);
  });

  it("should return false when project has no metadata", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {},
      projects: {},
      settings: {},
    };
    expect(isProjectHidden(metadata, "/path/to/project")).toBe(false);
  });

  it("should return true when project is explicitly hidden", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {},
      projects: {
        "/path/to/project": { hidden: true },
      },
      settings: {},
    };
    expect(isProjectHidden(metadata, "/path/to/project")).toBe(true);
  });

  it("should return false when project is explicitly not hidden", () => {
    const metadata: UserMetadata = {
      version: 1,
      sessions: {},
      projects: {
        "/path/to/project": { hidden: false },
      },
      settings: {},
    };
    expect(isProjectHidden(metadata, "/path/to/project")).toBe(false);
  });

  // Pattern matching tests
  describe("glob pattern matching", () => {
    it("should match exact pattern", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["folders-dg-test"],
        },
      };
      expect(isProjectHidden(metadata, "folders-dg-test")).toBe(true);
      expect(isProjectHidden(metadata, "folders-dg-other")).toBe(false);
    });

    it("should match wildcard (*) pattern", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["folders-dg-*"],
        },
      };
      expect(isProjectHidden(metadata, "folders-dg-test")).toBe(true);
      expect(isProjectHidden(metadata, "folders-dg-another")).toBe(true);
      expect(isProjectHidden(metadata, "folders-dg-")).toBe(true);
      expect(isProjectHidden(metadata, "folders-other")).toBe(false);
    });

    it("should match question mark (?) pattern", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["test-?"],
        },
      };
      expect(isProjectHidden(metadata, "test-a")).toBe(true);
      expect(isProjectHidden(metadata, "test-1")).toBe(true);
      expect(isProjectHidden(metadata, "test-ab")).toBe(false);
      expect(isProjectHidden(metadata, "test-")).toBe(false);
    });

    it("should match multiple patterns", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["temp-*", "backup-*", "*.old"],
        },
      };
      expect(isProjectHidden(metadata, "temp-project")).toBe(true);
      expect(isProjectHidden(metadata, "backup-data")).toBe(true);
      expect(isProjectHidden(metadata, "project.old")).toBe(true);
      expect(isProjectHidden(metadata, "normal-project")).toBe(false);
    });

    it("should handle empty patterns array", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: [],
        },
      };
      expect(isProjectHidden(metadata, "any-project")).toBe(false);
    });

    it("should escape regex special characters in pattern", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["project.backup"],
        },
      };
      // The dot should be literal, not a regex wildcard
      expect(isProjectHidden(metadata, "project.backup")).toBe(true);
      expect(isProjectHidden(metadata, "projectXbackup")).toBe(false);
    });
  });

  // Precedence tests
  describe("precedence", () => {
    it("should check explicit hidden flag before patterns", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {
          "temp-project": { hidden: true },
        },
        settings: {
          hiddenPatterns: [],
        },
      };
      expect(isProjectHidden(metadata, "temp-project")).toBe(true);
    });

    it("should still match pattern if project has no explicit metadata", () => {
      const metadata: UserMetadata = {
        version: 1,
        sessions: {},
        projects: {},
        settings: {
          hiddenPatterns: ["temp-*"],
        },
      };
      expect(isProjectHidden(metadata, "temp-project")).toBe(true);
    });
  });
});
