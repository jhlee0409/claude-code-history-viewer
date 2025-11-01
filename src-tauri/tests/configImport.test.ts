import { describe, it, expect } from 'vitest';
import tauriConfig from '../tauri.conf.json';

/**
 * Simple import test for Tauri configuration
 * Testing Framework: Vitest
 * 
 * Verifies that the configuration can be imported as a module
 * and maintains its structure when used programmatically.
 */
describe('Tauri Configuration Import Tests', () => {
  it('should successfully import configuration as JSON module', () => {
    expect(tauriConfig).toBeDefined();
    expect(typeof tauriConfig).toBe('object');
    expect(tauriConfig).not.toBeNull();
  });

  it('should have correct schema when imported', () => {
    expect(tauriConfig.$schema).toBe('https://schema.tauri.app/config/2');
  });

  it('should maintain product information when imported', () => {
    expect(tauriConfig.productName).toBe('Claude Code History Viewer');
    expect(tauriConfig.version).toBe('1.0.0-beta.4');
    expect(tauriConfig.identifier).toBe('com.claude.history-viewer');
  });

  it('should preserve nested object structure', () => {
    expect(tauriConfig.app.windows).toBeDefined();
    expect(Array.isArray(tauriConfig.app.windows)).toBe(true);
    expect(tauriConfig.app.security.capabilities).toBeDefined();
    expect(Array.isArray(tauriConfig.app.security.capabilities)).toBe(true);
  });
});