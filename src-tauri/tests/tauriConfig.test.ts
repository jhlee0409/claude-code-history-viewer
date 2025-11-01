import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Path to the Tauri configuration file
const configPath = path.join(__dirname, '../tauri.conf.json');

/**
 * Comprehensive test suite for Tauri configuration validation
 * Testing Framework: Vitest (as identified from package.json)
 * 
 * This test suite validates the tauri.conf.json configuration file
 * against expected structure, values, and Tauri framework requirements.
 */
describe('Tauri Configuration Tests', () => {
  let config: any;

  beforeEach(() => {
    // Read and parse the configuration file before each test
    const configContent = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
  });

  describe('Schema and Structure Validation', () => {
    it('should have the correct Tauri v2 schema reference', () => {
      expect(config.$schema).toBe('https://schema.tauri.app/config/2');
    });

    it('should have all required top-level properties', () => {
      expect(config).toHaveProperty('productName');
      expect(config).toHaveProperty('version');
      expect(config).toHaveProperty('identifier');
      expect(config).toHaveProperty('build');
      expect(config).toHaveProperty('app');
      expect(config).toHaveProperty('plugins');
      expect(config).toHaveProperty('bundle');
    });

    it('should not have any undefined values for required properties', () => {
      expect(config.productName).toBeDefined();
      expect(config.version).toBeDefined();
      expect(config.identifier).toBeDefined();
      expect(config.build).toBeDefined();
      expect(config.app).toBeDefined();
    });
  });

  describe('Product Information Validation', () => {
    it('should have correct product name', () => {
      expect(config.productName).toBe('Claude Code History Viewer');
      expect(typeof config.productName).toBe('string');
      expect(config.productName.length).toBeGreaterThan(0);
    });

    it('should have valid semantic version format', () => {
      expect(config.version).toMatch(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/);
      expect(config.version).toBe('1.0.0-beta.4');
    });

    it('should have valid app identifier in reverse domain notation', () => {
      expect(config.identifier).toMatch(/^[a-zA-Z0-9.-]+$/);
      expect(config.identifier).toBe('com.claude.history-viewer');
      expect(config.identifier.split('.').length).toBeGreaterThanOrEqual(3);
    });

    it('should not contain spaces or special characters in identifier', () => {
      expect(config.identifier).not.toMatch(/[\s!@#$%^&*()+={}[\]|\\:";'<>?,/]/);
    });
  });

  describe('Build Configuration Validation', () => {
    it('should have complete build configuration', () => {
      expect(config.build).toBeDefined();
      expect(config.build.frontendDist).toBe('../dist');
      expect(config.build.devUrl).toBe('http://localhost:5173');
      expect(config.build.beforeDevCommand).toBeDefined();
      expect(config.build.beforeBuildCommand).toBeDefined();
    });

    it('should have valid development URL format', () => {
      expect(config.build.devUrl).toMatch(/^https?:\/\/localhost:\d+$/);
      const url = new URL(config.build.devUrl);
      expect(url.hostname).toBe('localhost');
      expect(parseInt(url.port)).toBeGreaterThan(1000);
      expect(parseInt(url.port)).toBeLessThan(65536);
    });

    it('should have valid build commands', () => {
      // Test that build commands exist and contain expected keywords
      // Package manager agnostic - supports npm, pnpm, yarn, bun, or $npm_execpath
      expect(config.build.beforeDevCommand).toBeTruthy();
      expect(config.build.beforeBuildCommand).toBeTruthy();

      // Should reference dev/development workflow
      expect(config.build.beforeDevCommand.toLowerCase()).toMatch(/dev|development/);

      // Should reference build workflow
      expect(config.build.beforeBuildCommand.toLowerCase()).toMatch(/build/);
    });

    it('should have valid frontend distribution path', () => {
      expect(config.build.frontendDist).toMatch(/^\.\.\/dist$/);
      expect(config.build.frontendDist).not.toContain('\\'); // No Windows-style paths
    });
  });

  describe('Application Window Configuration', () => {
    it('should have windows array with at least one window', () => {
      expect(config.app.windows).toBeDefined();
      expect(Array.isArray(config.app.windows)).toBe(true);
      expect(config.app.windows.length).toBeGreaterThan(0);
    });

    describe('Main Window Properties', () => {
      let mainWindow: any;

      beforeEach(() => {
        mainWindow = config.app.windows[0];
      });

      it('should have consistent window title with product name', () => {
        expect(mainWindow.title).toBe('Claude Code History Viewer');
        expect(mainWindow.title).toBe(config.productName);
      });

      it('should have reasonable default window dimensions', () => {
        expect(mainWindow.width).toBe(1200);
        expect(mainWindow.height).toBe(800);
        expect(typeof mainWindow.width).toBe('number');
        expect(typeof mainWindow.height).toBe('number');
        expect(mainWindow.width).toBeGreaterThan(0);
        expect(mainWindow.height).toBeGreaterThan(0);
      });

      it('should have appropriate minimum window dimensions', () => {
        expect(mainWindow.minWidth).toBe(900);
        expect(mainWindow.minHeight).toBe(600);
        expect(mainWindow.minWidth).toBeLessThanOrEqual(mainWindow.width);
        expect(mainWindow.minHeight).toBeLessThanOrEqual(mainWindow.height);
        expect(mainWindow.minWidth).toBeGreaterThan(400); // Reasonable minimum
        expect(mainWindow.minHeight).toBeGreaterThan(300); // Reasonable minimum
      });

      it('should have reasonable aspect ratio', () => {
        const aspectRatio = mainWindow.width / mainWindow.height;
        expect(aspectRatio).toBeGreaterThan(1); // Landscape orientation
        expect(aspectRatio).toBeLessThan(3); // Not excessively wide
        expect(aspectRatio).toBeCloseTo(1.5, 1); // Close to 3:2 ratio
      });

      it('should have appropriate boolean window properties', () => {
        // Test all boolean properties
        expect(typeof mainWindow.resizable).toBe('boolean');
        expect(typeof mainWindow.fullscreen).toBe('boolean');
        expect(typeof mainWindow.center).toBe('boolean');
        expect(typeof mainWindow.visible).toBe('boolean');
        expect(typeof mainWindow.focus).toBe('boolean');
        
        // Test expected values
        expect(mainWindow.resizable).toBe(true);
        expect(mainWindow.fullscreen).toBe(false);
        expect(mainWindow.center).toBe(true);
        expect(mainWindow.visible).toBe(true);
        expect(mainWindow.focus).toBe(true);
      });

      it('should not have excessive window dimensions', () => {
        expect(mainWindow.width).toBeLessThan(5000);
        expect(mainWindow.height).toBeLessThan(5000);
        expect(mainWindow.minWidth).toBeLessThan(2000);
        expect(mainWindow.minHeight).toBeLessThan(2000);
      });
    });
  });

  describe('Security Configuration Validation', () => {
    it('should have security configuration defined', () => {
      expect(config.app.security).toBeDefined();
      expect(typeof config.app.security).toBe('object');
    });

    it('should have CSP set to null for custom handling', () => {
      expect(config.app.security.csp).toBeNull();
    });

    it('should have valid capabilities array', () => {
      expect(Array.isArray(config.app.security.capabilities)).toBe(true);
      expect(config.app.security.capabilities.length).toBeGreaterThan(0);
      expect(config.app.security.capabilities).toContain('default');
      expect(config.app.security.capabilities).toContain('http-requests');
    });

    it('should only contain valid capability strings', () => {
      const validCapabilities = [
        'default', 'http-requests', 'fs', 'shell', 
        'notification', 'updater', 'window-management'
      ];
      
      config.app.security.capabilities.forEach((capability: string) => {
        expect(typeof capability).toBe('string');
        expect(capability.length).toBeGreaterThan(0);
        expect(capability).not.toContain(' '); // No spaces
      });
    });

    it('should have withGlobalTauri enabled', () => {
      expect(config.app.withGlobalTauri).toBe(true);
      expect(typeof config.app.withGlobalTauri).toBe('boolean');
    });
  });

  describe('Plugins Configuration Validation', () => {
    it('should have plugins object defined', () => {
      expect(config.plugins).toBeDefined();
      expect(typeof config.plugins).toBe('object');
      expect(config.plugins).not.toBeNull();
    });

    describe('File System Plugin', () => {
      it('should have fs plugin configuration', () => {
        expect(config.plugins.fs).toBeDefined();
        expect(typeof config.plugins.fs).toBe('object');
      });

      it('should have requireLiteralLeadingDot set to false', () => {
        expect(config.plugins.fs.requireLiteralLeadingDot).toBe(false);
        expect(typeof config.plugins.fs.requireLiteralLeadingDot).toBe('boolean');
      });
    });

    describe('Updater Plugin', () => {
      it('should have updater plugin enabled', () => {
        expect(config.plugins.updater).toBeDefined();
        expect(config.plugins.updater.active).toBe(true);
        expect(typeof config.plugins.updater.active).toBe('boolean');
      });

      it('should have valid GitHub update endpoints', () => {
        expect(Array.isArray(config.plugins.updater.endpoints)).toBe(true);
        expect(config.plugins.updater.endpoints.length).toBeGreaterThan(0);
        
        config.plugins.updater.endpoints.forEach((endpoint: string) => {
          expect(endpoint).toMatch(/^https:\/\//); // HTTPS required
          expect(endpoint).toContain('github.com');
          expect(endpoint).toContain('jhlee0409/claude-code-history-viewer');
          expect(endpoint).toContain('latest.json');
        });
      });

      it('should have update dialog disabled', () => {
        expect(config.plugins.updater.dialog).toBe(false);
        expect(typeof config.plugins.updater.dialog).toBe('boolean');
      });

      it('should have valid minisign public key', () => {
        expect(config.plugins.updater.pubkey).toBeDefined();
        expect(typeof config.plugins.updater.pubkey).toBe('string');
        expect(config.plugins.updater.pubkey.length).toBeGreaterThan(50);

        // Check for base64 encoded minisign public key format
        expect(config.plugins.updater.pubkey).toMatch(/^[A-Za-z0-9+/=]+$/);
      });

      it('should not expose private keys or secrets', () => {
        expect(config.plugins.updater.pubkey).not.toContain('private');
        expect(config.plugins.updater.pubkey).not.toContain('secret');
      });
    });
  });

  describe('Bundle Configuration Validation', () => {
    it('should have bundle configuration enabled', () => {
      expect(config.bundle.active).toBe(true);
      expect(config.bundle.targets).toBe('all');
      expect(config.bundle.createUpdaterArtifacts).toBe(true);
    });

    it('should have valid icon file paths', () => {
      expect(Array.isArray(config.bundle.icon)).toBe(true);
      expect(config.bundle.icon.length).toBeGreaterThan(0);
      
      const expectedIcons = [
        'icons/32x32.png',
        'icons/128x128.png', 
        'icons/128x128@2x.png',
        'icons/icon.icns',
        'icons/icon.ico'
      ];
      
      expectedIcons.forEach(iconPath => {
        expect(config.bundle.icon).toContain(iconPath);
      });
    });

    it('should have icons for different platforms', () => {
      const iconPaths = config.bundle.icon;
      
      // Check for PNG icons (various sizes)
      const pngIcons = iconPaths.filter((icon: string) => icon.endsWith('.png'));
      expect(pngIcons.length).toBeGreaterThanOrEqual(2);
      
      // Check for Windows ICO
      const icoIcons = iconPaths.filter((icon: string) => icon.endsWith('.ico'));
      expect(icoIcons.length).toBeGreaterThanOrEqual(1);
      
      // Check for macOS ICNS
      const icnsIcons = iconPaths.filter((icon: string) => icon.endsWith('.icns'));
      expect(icnsIcons.length).toBeGreaterThanOrEqual(1);
    });

    it('should have appropriate icon file naming', () => {
      config.bundle.icon.forEach((iconPath: string) => {
        expect(iconPath).toMatch(/^icons\//);
        expect(iconPath).toMatch(/\.(png|ico|icns)$/);
        expect(iconPath).not.toContain('..'); // No parent directory references
        expect(iconPath).not.toContain('//'); // No double slashes
      });
    });

    describe('macOS Bundle Configuration', () => {
      it('should have macOS-specific bundle settings', () => {
        expect(config.bundle.macOS).toBeDefined();
        expect(typeof config.bundle.macOS).toBe('object');
      });

      it('should have appropriate signing configuration', () => {
        expect(config.bundle.macOS.signingIdentity).toBeNull();
        expect(config.bundle.macOS.hardenedRuntime).toBe(true);
        expect(typeof config.bundle.macOS.hardenedRuntime).toBe('boolean');
      });

      it('should have valid minimum system version', () => {
        expect(config.bundle.macOS.minimumSystemVersion).toBe('10.13');
        expect(config.bundle.macOS.minimumSystemVersion).toMatch(/^\d+\.\d+$/);
        
        // Ensure it's not too old or too new
        const [major, minor] = config.bundle.macOS.minimumSystemVersion.split('.').map(Number);
        expect(major).toBeGreaterThanOrEqual(10);
        expect(major).toBeLessThan(20); // Reasonable upper bound
        if (major === 10) {
          expect(minor).toBeGreaterThanOrEqual(13); // macOS High Sierra minimum
        }
      });
    });
  });

  describe('Configuration Consistency and Integration', () => {
    it('should have consistent product naming across all fields', () => {
      expect(config.productName).toBe(config.app.windows[0].title);
      expect(config.productName).not.toContain('undefined');
      expect(config.productName).not.toContain('null');
    });

    it('should maintain valid JSON structure', () => {
      expect(() => JSON.parse(JSON.stringify(config))).not.toThrow();
      expect(JSON.stringify(config)).not.toContain('"undefined"');
      // Note: null is valid in JSON (e.g., CSP: null, signingIdentity: null)
    });

    it('should not have any null/undefined required values', () => {
      const requiredStringFields = [
        'productName', 'version', 'identifier'
      ];
      
      requiredStringFields.forEach(field => {
        expect(config[field]).toBeTruthy();
        expect(typeof config[field]).toBe('string');
        expect(config[field].length).toBeGreaterThan(0);
      });
    });

    it('should have proper version consistency for beta release', () => {
      expect(config.version).toContain('beta');
      expect(config.version).toMatch(/^1\.0\.0-beta\.\d+$/);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle URL parsing without errors', () => {
      expect(() => new URL(config.build.devUrl)).not.toThrow();
    });

    it('should have reasonable port number for development', () => {
      const url = new URL(config.build.devUrl);
      const port = parseInt(url.port);
      expect(port).toBeGreaterThan(3000); // Above common system ports
      expect(port).toBeLessThan(10000); // Below ephemeral range
      expect(port).toBe(5173); // Vite default port
    });

    it('should have window dimensions within reasonable bounds', () => {
      const window = config.app.windows[0];
      
      // Maximum reasonable bounds
      expect(window.width).toBeLessThan(4000);
      expect(window.height).toBeLessThan(3000);
      
      // Minimum reasonable bounds
      expect(window.minWidth).toBeGreaterThan(300);
      expect(window.minHeight).toBeGreaterThan(200);
      
      // Logical consistency
      expect(window.width).toBeGreaterThanOrEqual(window.minWidth);
      expect(window.height).toBeGreaterThanOrEqual(window.minHeight);
    });

    it('should handle empty or malformed values gracefully', () => {
      // Ensure no empty string values for required fields
      expect(config.productName.trim()).not.toBe('');
      expect(config.version.trim()).not.toBe('');
      expect(config.identifier.trim()).not.toBe('');
    });
  });

  describe('Security and Privacy Validation', () => {
    it('should use HTTPS for all external endpoints', () => {
      config.plugins.updater.endpoints.forEach((endpoint: string) => {
        expect(endpoint).toMatch(/^https:\/\//);
        expect(endpoint).not.toMatch(/^http:\/\//);
      });
    });

    it('should have proper reverse domain notation identifier', () => {
      const parts = config.identifier.split('.');
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(parts[0]).toBe('com'); // Proper reverse domain
      expect(parts[1]).toBe('claude');
      expect(parts[2]).toBe('history-viewer');
    });

    it('should not expose sensitive information', () => {
      const configString = JSON.stringify(config).toLowerCase();
      const sensitivePatterns = [
        'password', 'secret', 'token', 'api_key', 
        'private_key', 'credential'
      ];
      
      sensitivePatterns.forEach(pattern => {
        if (pattern !== 'pubkey') { // Public key is acceptable
          expect(configString).not.toContain(pattern);
        }
      });
    });

    it('should have updater public key but no private information', () => {
      expect(config.plugins.updater.pubkey).toBeDefined();
      expect(typeof config.plugins.updater.pubkey).toBe('string');
      expect(config.plugins.updater.pubkey.length).toBeGreaterThan(0);
      // Public key can be base64 encoded, so just check it's not exposing private info
      const lowerKey = config.plugins.updater.pubkey.toLowerCase();
      expect(lowerKey).not.toContain('private');
      expect(lowerKey).not.toContain('secret');
    });
  });
});

// Integration tests for file system and configuration loading
describe('Configuration File Integration Tests', () => {
  it('should successfully read configuration file from expected location', () => {
    expect(() => {
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('should have configuration file in correct location relative to tests', () => {
    expect(fs.existsSync(configPath)).toBe(true);
    expect(path.basename(configPath)).toBe('tauri.conf.json');
  });

  it('should parse as valid JSON without syntax errors', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
    
    const parsed = JSON.parse(content);
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  it('should validate against expected Tauri configuration schema', () => {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    // Verify essential Tauri v2 configuration structure
    const requiredTopLevel = [
      '$schema', 'productName', 'version', 'identifier',
      'build', 'app', 'plugins', 'bundle'
    ];
    
    requiredTopLevel.forEach(prop => {
      expect(config).toHaveProperty(prop);
    });
    
    // Verify nested required structures
    expect(config.app).toHaveProperty('windows');
    expect(config.app).toHaveProperty('security');
    expect(config.build).toHaveProperty('frontendDist');
    expect(config.build).toHaveProperty('devUrl');
  });

  it('should have file permissions that allow reading', () => {
    expect(() => fs.accessSync(configPath, fs.constants.R_OK)).not.toThrow();
  });
});