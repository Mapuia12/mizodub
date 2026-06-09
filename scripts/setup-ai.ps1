param(
    [string]$VenvPath = ".venv-ai"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Requirements = Join-Path $ProjectRoot "tools\python\requirements-ai.txt"
$Venv = Join-Path $ProjectRoot $VenvPath

# Prefer 3.11 for ML stability; accept 3.12, 3.13, 3.14 if that's all that exists
$PyExe  = $null
$PyFlag = $null

foreach ($ver in @("3.11", "3.12", "3.13", "3.14")) {
    try {
        $out = & py -$ver --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Found Python $ver  ($($out -replace '\r?\n.*', ''))"
            $PyExe  = "py"
            $PyFlag = "-$ver"
            break
        }
    } catch {}
}

if (-not $PyExe) {
    # Fallback: bare 'python' (standalone installer, conda, winget, etc.)
    try {
        $out = & python --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Using system Python: $($out -replace '\r?\n.*', '')"
            $PyExe = "python"
        }
    } catch {}
}

if (-not $PyExe) {
    Write-Error @"
No compatible Python found (tried 3.11-3.14 via 'py' launcher and bare 'python').
Install Python 3.11-3.14 from https://www.python.org/downloads/
and tick "Add python.exe to PATH" in the installer.
"@
    exit 1
}

$venvArgs = if ($PyFlag) { @($PyFlag, "-m", "venv", $Venv) } else { @("-m", "venv", $Venv) }
Write-Host "Creating AI environment at $Venv"
& $PyExe @venvArgs

$Pip = Join-Path $Venv "Scripts\pip.exe"

# Self-upgrade pip (non-fatal if it fails)
& $Pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Warning "pip self-upgrade failed — continuing with existing pip version"
}

# Install AI packages — fatal if this fails
& $Pip install --no-cache-dir -r $Requirements
if ($LASTEXITCODE -ne 0) {
    Write-Error @"
Package installation failed (see errors above).
Common fixes:
  - Temporarily pause Windows Defender real-time protection and retry
  - Run: $Pip install --no-cache-dir -r $Requirements
"@
    exit 1
}

Write-Host ""
Write-Host "AI helpers installed successfully."
Write-Host "Restart Mizo Dub Studio to use transcription and translation."