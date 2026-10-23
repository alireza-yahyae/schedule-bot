# Registers the Telegram webhook for your bot.
# Run it from the project folder with:
#   powershell -ExecutionPolicy Bypass -File .\scripts\set-webhook.ps1
# It asks for 3 things. What you type for the token and the secret is hidden.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function ConvertTo-PlainText([System.Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$workerUrl = (Read-Host "Worker URL (example: https://schedule-bot.yourname.workers.dev)").Trim().TrimEnd("/")
if ($workerUrl -notmatch "^https://") { throw "The URL must start with https://" }

$token  = ConvertTo-PlainText (Read-Host "BOT_TOKEN (typing is hidden)" -AsSecureString)
$secret = ConvertTo-PlainText (Read-Host "WEBHOOK_SECRET - the same one you saved in Cloudflare (typing is hidden)" -AsSecureString)

$body = @{
    url                  = "$workerUrl/webhook"
    secret_token         = $secret
    allowed_updates      = @("message", "callback_query")
    drop_pending_updates = $true
} | ConvertTo-Json -Compress

$result = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType "application/json" -Body $body
if ($result.ok) {
    Write-Host "OK: the webhook is set." -ForegroundColor Green
} else {
    Write-Host "FAILED: $($result.description)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Webhook status from Telegram:"
$info = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
$info.result | Select-Object url, pending_update_count, last_error_date, last_error_message | Format-List
Write-Host "If last_error_message is empty, everything is fine."
