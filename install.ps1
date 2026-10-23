# One-line installer for Schedule Bot.
# Paste this in PowerShell:
#   irm https://raw.githubusercontent.com/alireza-yahyae/schedule-bot/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = "alireza-yahyae/schedule-bot"
$branch = "main"
$dest = Join-Path $HOME "schedule-bot"

Write-Host ""
Write-Host "  Schedule Bot - installer" -ForegroundColor White
Write-Host "  Folder: $dest" -ForegroundColor Gray

$zip = Join-Path $env:TEMP "schedule-bot-download.zip"
$tmp = Join-Path $env:TEMP ("schedule-bot-" + [guid]::NewGuid().ToString("N"))
try {
    Write-Host "  Downloading the latest version..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://github.com/$repo/archive/refs/heads/$branch.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
} catch {
    Write-Host ""
    Write-Host "  Could not download the project: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Check your internet connection, and that https://github.com/$repo is public." -ForegroundColor Yellow
    exit 1
}

$inner = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }
# Copy over the folder; your own files (wrangler.toml, node_modules) are not in the download, so they stay untouched.
Copy-Item -Path (Join-Path $inner.FullName "*") -Destination $dest -Recurse -Force
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Set-Location $dest
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest "setup.ps1")
