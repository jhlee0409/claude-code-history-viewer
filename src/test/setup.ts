import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

// Mock Tauri APIs for testing environment
interface TauriMock {
  tauri: {
    invoke: ReturnType<typeof vi.fn>;
  };
  event: {
    listen: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };
}

global.window = global.window || {};
(global.window as typeof global.window & { __TAURI__: TauriMock }).__TAURI__ = {
  tauri: {
    invoke: vi.fn(),
  },
  event: {
    listen: vi.fn(),
    emit: vi.fn(),
  },
};

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
  };
}

let testStorage: Storage | undefined;
let needsMemoryStorage = false;

function installMemoryStorage(): Storage {
  const storage = createMemoryStorage();
  testStorage = storage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

try {
  testStorage = globalThis.localStorage;
  needsMemoryStorage = typeof testStorage?.clear !== 'function';
} catch {
  needsMemoryStorage = true;
}

if (needsMemoryStorage) {
  installMemoryStorage();
}

beforeEach(() => {
  try {
    testStorage?.clear();
  } catch {
    installMemoryStorage().clear();
  }
});

// Mock matchMedia for components that use media queries
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver for virtual scrolling components
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve() {}
} as unknown as {
  new (): IntersectionObserver;
  prototype: IntersectionObserver;
};

// Mock ResizeObserver for components that observe size changes
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as unknown as {
  new (): ResizeObserver;
  prototype: ResizeObserver;
};
