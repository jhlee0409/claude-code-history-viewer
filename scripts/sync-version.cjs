#!/usr/bin/env node

/**
 * package.json의 버전을 src-tauri/Cargo.toml과 src-tauri/tauri.conf.json에 동기화하는 스크립트
 *
 * Single Source of Truth: package.json
 *
 * 동기화 대상:
 *   - src-tauri/Cargo.toml (Rust 백엔드 버전)
 *   - src-tauri/tauri.conf.json (Tauri 앱 버전, 업데이터에서 사용)
 *
 * 사용법:
 *   node scripts/sync-version.cjs
 *   just sync-version
 */

const fs = require("fs");
const path = require("path");

const packageJsonPath = path.join(process.cwd(), "package.json");
const cargoTomlPath = path.join(process.cwd(), "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(process.cwd(), "src-tauri", "tauri.conf.json");

// 1. package.json에서 버전 읽기 (Single Source of Truth)
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

console.log(`[sync-version] package.json 버전: ${version}`);

// 2. Cargo.toml 동기화
let cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const versionRegex = /^version\s*=\s*"[^\"]*"/m;

if (!versionRegex.test(cargoToml)) {
  console.error("[sync-version] Cargo.toml에서 version 라인을 찾을 수 없습니다.");
  process.exit(1);
}

cargoToml = cargoToml.replace(versionRegex, `version = "${version}"`);
fs.writeFileSync(cargoTomlPath, cargoToml);
console.log(`[sync-version] ✓ Cargo.toml → ${version}`);

// 3. tauri.conf.json 동기화
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
const oldTauriVersion = tauriConf.version;
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
console.log(`[sync-version] ✓ tauri.conf.json → ${version} (이전: ${oldTauriVersion})`);

console.log(`[sync-version] 모든 파일이 ${version}로 동기화되었습니다.`);
