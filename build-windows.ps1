# Build script for Windows
$ErrorActionPreference = "Stop"

# Set Rust environment variables
$env:RUSTUP_HOME = "D:\Rust\.rustup"
$env:CARGO_HOME = "D:\Rust\.cargo"
$env:Path = "D:\Rust\.cargo\bin;" + $env:Path

Write-Host "Building Tauri application for Windows..." -ForegroundColor Cyan
Write-Host "Rust location: $env:CARGO_HOME" -ForegroundColor Yellow

# Verify cargo is available
try {
    $cargoVersion = & cargo --version
    Write-Host "Cargo found: $cargoVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Cargo not found in PATH" -ForegroundColor Red
    Write-Host "CARGO_HOME: $env:CARGO_HOME" -ForegroundColor Yellow
    Write-Host "PATH: $env:Path" -ForegroundColor Yellow
    exit 1
}

# Run the build
Write-Host ""
Write-Host "Starting Tauri build..." -ForegroundColor Cyan
pnpm tauri build

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Build completed successfully!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
