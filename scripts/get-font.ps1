# Downloads the Vazirmatn font into public\fonts (one time).
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File .\scripts\get-font.ps1
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path "public\fonts" | Out-Null
$target = "public\fonts\Vazirmatn.woff2"
$urls = @(
    "https://cdn.jsdelivr.net/npm/vazirmatn@33.003/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2",
    "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2",
    "https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2"
)
$done = $false
foreach ($u in $urls) {
    try {
        Write-Host "Trying $u"
        Invoke-WebRequest -Uri $u -OutFile $target -UseBasicParsing
        if ((Get-Item $target).Length -gt 20000) { $done = $true; break }
    } catch {
        Write-Host "  failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
if ($done) {
    Write-Host "OK: font saved to $target ($((Get-Item $target).Length) bytes)" -ForegroundColor Green
} else {
    Write-Host "Could not download the font. The app still works with the system font." -ForegroundColor Red
}
