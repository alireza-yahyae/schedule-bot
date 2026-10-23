<#
  Guided first-time setup for Schedule Bot (Windows PowerShell).

  Run it from the project folder:
      powershell -ExecutionPolicy Bypass -File .\setup.ps1

  It installs what is missing, signs you in to Cloudflare in your browser, creates the database,
  deploys the bot, stores your secrets safely and connects Telegram.
  It is safe to run again: it reuses what already exists.
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location $PSScriptRoot
. "$PSScriptRoot\scripts\lib.ps1"

Write-Host ""
Write-Host "  Schedule Bot - setup" -ForegroundColor White
Write-Host "  About 10 minutes. You will need: a Cloudflare account, a bot token from @BotFather," -ForegroundColor Gray
Write-Host "  and your numeric Telegram id (message @userinfobot to get it)." -ForegroundColor Gray

# ------------------------------------------------------------------ 1. Node.js and packages
Step "1/8" "Checking Node.js and installing packages"
Ensure-Node
$r = Invoke-Native "npm.cmd" @("install", "--no-audit", "--no-fund")
if ($r.Code -ne 0) { Stop-Setup "npm install failed (see the messages above). Check your internet connection." }
Ok "Packages installed"

# ------------------------------------------------------------------ 2. Cloudflare login
Step "2/8" "Signing in to Cloudflare"
$who = Invoke-Native "npx.cmd" @("wrangler", "whoami") -Quiet
if ($who.Text -match "not authenticated" -or $who.Code -ne 0) {
    Info "Your browser will open. Sign in to Cloudflare and press Allow."
    $code = Invoke-Interactive "npx.cmd" @("wrangler", "login")
    if ($code -ne 0) { Stop-Setup "Cloudflare login did not finish." }
} else {
    Ok "Already signed in"
}

# ------------------------------------------------------------------ 3. wrangler.toml
Step "3/8" "Preparing wrangler.toml"
if (-not (Test-Path ".\wrangler.toml")) {
    Copy-Item ".\wrangler.example.toml" ".\wrangler.toml"
    Ok "Created wrangler.toml from the template"
} else {
    Ok "wrangler.toml already exists"
}
$toml = Get-Content ".\wrangler.toml" -Raw
$dbName = "schedule-bot-db"
if ($toml -match 'database_name\s*=\s*"([^"]+)"') { $dbName = $Matches[1] }

# ------------------------------------------------------------------ 4. Database
Step "4/8" "Creating the database ($dbName)"
function Find-DatabaseId([string]$Name) {
    $list = Invoke-Native "npx.cmd" @("wrangler", "d1", "list", "--json") -Quiet
    if ($list.Text -match "(?s)(\[.*\])") {
        try {
            $items = $Matches[1] | ConvertFrom-Json
            foreach ($i in $items) { if ($i.name -eq $Name) { if ($i.uuid) { return $i.uuid } else { return $i.id } } }
        } catch { }
    }
    return $null
}
if ($toml -match 'database_id\s*=\s*"REPLACE_WITH_YOUR_DATABASE_ID"') {
    $dbId = Find-DatabaseId $dbName
    if ($dbId) {
        Ok "Found your existing database"
    } else {
        $c = Invoke-Native "npx.cmd" @("wrangler", "d1", "create", $dbName) -Quiet
        if ($c.Text -match 'database_id"?\s*[:=]\s*"([0-9a-fA-F-]{36})"') { $dbId = $Matches[1] } else { $dbId = Find-DatabaseId $dbName }
        if (-not $dbId) { Write-Host $c.Text; Stop-Setup "Could not create or find the database. See the message above." }
        Ok "Database created"
    }
    $toml = $toml -replace 'database_id\s*=\s*"REPLACE_WITH_YOUR_DATABASE_ID"', "database_id = `"$dbId`""
    Write-Utf8 ".\wrangler.toml" $toml
} else {
    Ok "wrangler.toml already has a database id"
}

Step "5/8" "Creating the tables"
$m = Invoke-Native "npm.cmd" @("run", "db:migrate")
if ($m.Code -ne 0) { Stop-Setup "Could not create the tables. See the message above." }
Ok "Tables are ready"

# ------------------------------------------------------------------ 6. Deploy
Step "6/8" "Publishing the bot to Cloudflare"
$d = Invoke-Native "npm.cmd" @("run", "deploy")
$url = $null
if ($d.Code -eq 0 -and $d.Text -match "(https://[A-Za-z0-9.-]+\.workers\.dev)") { $url = $Matches[1] }
elseif ($d.Code -ne 0 -and $d.Text -match "workers\.dev subdomain") {
    Warn "Cloudflare wants you to choose a free workers.dev name first. Answer the question below."
    $code = Invoke-Interactive "npm.cmd" @("run", "deploy")
    if ($code -ne 0) { Stop-Setup "Publishing failed." }
    $url = (Read-Host "    Paste the https://....workers.dev address printed above").Trim().TrimEnd("/")
} elseif ($d.Code -ne 0) {
    Stop-Setup "Publishing failed. See the message above."
}
if (-not $url -or $url -notmatch "^https://") { Stop-Setup "I could not find your bot's address in the output." }
Ok "Published: $url"

$toml = Get-Content ".\wrangler.toml" -Raw
if ($toml -notmatch [regex]::Escape("APP_URL = `"$url`"")) {
    $toml = $toml -replace 'APP_URL\s*=\s*"[^"]*"', "APP_URL = `"$url`""
    Write-Utf8 ".\wrangler.toml" $toml
    Info "Saving your address and publishing once more..."
    $d2 = Invoke-Native "npm.cmd" @("run", "deploy") -Quiet
    if ($d2.Code -ne 0) { Write-Host $d2.Text; Stop-Setup "The second publish failed." }
    Ok "Address saved"
}

# ------------------------------------------------------------------ 7. Secrets
Step "7/8" "Saving your secrets (they are stored in Cloudflare, not in any file)"
$existing = @()
$sl = Invoke-Native "npx.cmd" @("wrangler", "secret", "list") -Quiet
if ($sl.Text -match "(?s)(\[.*\])") { try { $existing = @(($Matches[1] | ConvertFrom-Json) | ForEach-Object { $_.name }) } catch { } }
$haveAll = ($existing -contains "BOT_TOKEN") -and ($existing -contains "WEBHOOK_SECRET") -and ($existing -contains "OWNER_ID")
$token = $null
$botUser = $null
if ($haveAll -and -not (Ask-YesNo "All three secrets already exist. Replace them?" $false)) {
    Ok "Keeping the existing secrets"
    $skipWebhook = $true
} else {
    $skipWebhook = $false
    Info "BOT_TOKEN: from @BotFather in Telegram (looks like 123456789:AAH...). Typing is hidden."
    for ($try = 1; $try -le 3 -and -not $botUser; $try++) {
        $token = (ConvertTo-PlainText (Read-Host "    BOT_TOKEN" -AsSecureString)).Trim()
        try {
            $me = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getMe"
            if ($me.ok) { $botUser = $me.result.username }
        } catch { Warn "Telegram did not accept this token. Check it and try again." }
    }
    if (-not $botUser) { Stop-Setup "The bot token is not valid." }
    Ok "Token is valid: @$botUser"

    Info "OWNER_ID: your own numeric Telegram id (message @userinfobot to see it)."
    $owner = $null
    for ($try = 1; $try -le 3 -and -not $owner; $try++) {
        $o = (Read-Host "    OWNER_ID").Trim()
        if ($o -match "^\d{5,15}$") { $owner = $o } else { Warn "It must be only digits, for example 123456789." }
    }
    if (-not $owner) { Stop-Setup "OWNER_ID is not valid." }

    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

    foreach ($pair in @(@("BOT_TOKEN", $token), @("OWNER_ID", $owner), @("WEBHOOK_SECRET", $secret))) {
        $p = Invoke-Native "npx.cmd" @("wrangler", "secret", "put", $pair[0]) -Quiet -InputText $pair[1]
        if ($p.Code -ne 0) { Write-Host $p.Text; Stop-Setup "Could not save $($pair[0])." }
        Ok "$($pair[0]) saved"
    }
}

# ------------------------------------------------------------------ 8. Telegram webhook
Step "8/8" "Connecting Telegram to your bot"
if ($skipWebhook) {
    Info "Skipped (kept existing secrets). If the bot ever stops answering, run: powershell -ExecutionPolicy Bypass -File .\scripts\set-webhook.ps1"
} else {
    $body = @{ url = "$url/webhook"; secret_token = $secret; allowed_updates = @("message", "callback_query"); drop_pending_updates = $true } | ConvertTo-Json -Compress
    $hook = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType "application/json" -Body $body
    if (-not $hook.ok) { Stop-Setup "Telegram refused the webhook: $($hook.description)" }
    Ok "Webhook set"
}

$healthy = $false
for ($i = 1; $i -le 6 -and -not $healthy; $i++) {
    try { $h = Invoke-RestMethod -Uri "$url/health"; if ($h.ok) { $healthy = $true } } catch { Start-Sleep -Seconds 3 }
}
if ($healthy) { Ok "Health check passed" } else { Warn "The health check did not answer yet. Wait a minute and open $url/health in your browser." }

Write-Host ""
Write-Host "  All done!" -ForegroundColor Green
Write-Host "  1. Open your bot in Telegram" -ForegroundColor White
if ($botUser) { Write-Host "     https://t.me/$botUser" -ForegroundColor White }
Write-Host "  2. Send /start, then tap the app button to open the Mini App." -ForegroundColor White
Write-Host "  3. Later, update with: powershell -ExecutionPolicy Bypass -File .\update.ps1" -ForegroundColor White
Write-Host ""
if ($botUser) { Start-Process "https://t.me/$botUser" }
