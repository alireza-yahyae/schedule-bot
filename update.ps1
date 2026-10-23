<#
  Updates Schedule Bot to the newest version and publishes it.

      powershell -ExecutionPolicy Bypass -File .\update.ps1

  Your wrangler.toml and your secrets are kept.
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location $PSScriptRoot
. "$PSScriptRoot\scripts\lib.ps1"

$repo = "alireza-yahyae/schedule-bot"
$branch = "main"

Step "1/4" "Getting the newest version"
$git = Get-Command git -ErrorAction SilentlyContinue
if ((Test-Path ".\.git") -and $git) {
    $pull = Invoke-Native "git" @("pull", "--ff-only")
    if ($pull.Code -ne 0) { Stop-Setup "git pull failed. You may have changed files by hand; commit or undo them first." }
} else {
    $zip = Join-Path $env:TEMP "schedule-bot-update.zip"
    $tmp = Join-Path $env:TEMP ("schedule-bot-" + [guid]::NewGuid().ToString("N"))
    try {
        Invoke-WebRequest -Uri "https://github.com/$repo/archive/refs/heads/$branch.zip" -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
    } catch { Stop-Setup "Could not download the update: $($_.Exception.Message)" }
    $inner = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
    Copy-Item -Path (Join-Path $inner.FullName "*") -Destination $PSScriptRoot -Recurse -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Ok "Files are up to date"

Step "2/4" "Checking Node.js and packages"
Ensure-Node
$r = Invoke-Native "npm.cmd" @("install", "--no-audit", "--no-fund")
if ($r.Code -ne 0) { Stop-Setup "npm install failed." }
Ok "Packages ready"

Step "3/4" "Updating the database tables"
$m = Invoke-Native "npm.cmd" @("run", "db:migrate")
if ($m.Code -ne 0) { Stop-Setup "The database update failed. See the message above." }
Ok "Database is up to date"

Step "4/4" "Publishing"
$d = Invoke-Native "npm.cmd" @("run", "deploy")
if ($d.Code -ne 0) { Stop-Setup "Publishing failed. See the message above." }
Ok "Done. Your bot is updated."
