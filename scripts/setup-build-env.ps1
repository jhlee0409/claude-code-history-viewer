# Build Environment Setup Script for Claude Code History Viewer (Windows)
# This script sets up the development environment for building the app on Windows

Write-Host "Setting up build environment for Claude Code History Viewer..." -ForegroundColor Cyan

# Check if Node.js is installed
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Node.js found: $nodeVersion" -ForegroundColor Green
    } else {
        throw "Node.js not found"
    }
} catch {
    Write-Host "Node.js is required but not installed. Please install Node.js 18+ first." -ForegroundColor Red
    Write-Host "Visit: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check if pnpm is installed, install if not
try {
    $pnpmVersion = pnpm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "pnpm found: $pnpmVersion" -ForegroundColor Green
    } else {
        throw "pnpm not found"
    }
} catch {
    Write-Host "Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install pnpm" -ForegroundColor Red
        exit 1
    }
}

# Check if Rust is installed
try {
    $rustVersion = rustc --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Rust found: $rustVersion" -ForegroundColor Green
    } else {
        throw "Rust not found"
    }
} catch {
    Write-Host "Rust is required but not installed." -ForegroundColor Yellow
    Write-Host "Please install Rust from: https://www.rust-lang.org/tools/install" -ForegroundColor Yellow
    Write-Host "Run this command in PowerShell:" -ForegroundColor Yellow
    Write-Host "Invoke-WebRequest -Uri https://win.rustup.rs/ -OutFile rustup-init.exe; .\rustup-init.exe" -ForegroundColor Cyan

    $response = Read-Host "Would you like to download and run the Rust installer now? (y/N)"
    if ($response -eq 'y' -or $response -eq 'Y') {
        Write-Host "Downloading Rust installer..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri https://win.rustup.rs/ -OutFile "$env:TEMP\rustup-init.exe"
        Write-Host "Running Rust installer..." -ForegroundColor Yellow
        Start-Process -FilePath "$env:TEMP\rustup-init.exe" -Wait

        # Refresh environment variables
        $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path = $machinePath + ";" + $userPath

        Write-Host "Rust installation complete. Please close and reopen your terminal." -ForegroundColor Green
    } else {
        Write-Host "Please install Rust manually and run this script again." -ForegroundColor Yellow
        exit 1
    }
}

# Install project dependencies
Write-Host "Installing project dependencies..." -ForegroundColor Yellow
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install project dependencies" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Build environment setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - For development: pnpm tauri:dev" -ForegroundColor White
Write-Host "  - For production build: pnpm tauri:build" -ForegroundColor White
Write-Host "  - For auto-detected platform build: pnpm tauri:build:auto" -ForegroundColor White
Write-Host ""
Write-Host "The app includes full English language support by default." -ForegroundColor Cyan
Write-Host "Additional languages: Korean, Japanese, Chinese (Simplified and Traditional)" -ForegroundColor Cyan
