param(
    [string]$Python = "py",
    [string[]]$PythonArgs = @("-3.11"),
    [string]$VenvPath = ".venv-ai"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Requirements = Join-Path $ProjectRoot "tools\python\requirements-ai.txt"
$Venv = Join-Path $ProjectRoot $VenvPath

Write-Host "Creating AI environment at $Venv"
& $Python @PythonArgs -m venv $Venv

$Pip = Join-Path $Venv "Scripts\pip.exe"
& $Pip install --upgrade pip
& $Pip install -r $Requirements

Write-Host "AI helpers installed. Restart the app after setup."
