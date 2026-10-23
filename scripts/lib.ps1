# Small helpers shared by setup.ps1 and update.ps1 (not meant to be run by itself).

function Step([string]$Number, [string]$Text) { Write-Host ""; Write-Host "[$Number] $Text" -ForegroundColor Cyan }
function Ok([string]$Text)   { Write-Host "    OK  $Text" -ForegroundColor Green }
function Info([string]$Text) { Write-Host "    $Text" }
function Warn([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }
function Stop-Setup([string]$Text) {
    Write-Host ""
    Write-Host "STOPPED: $Text" -ForegroundColor Red
    Write-Host "Fix the problem above and run the same command again. It is safe to repeat." -ForegroundColor Yellow
    exit 1
}

# Windows only updates PATH for NEW windows; this reloads it inside the current one (after winget installs something).
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

# Runs a program, shows its output, and returns @{ Code; Text }. Never throws because of text on stderr.
function Invoke-Native {
    param([string]$File, [string[]]$Arguments = @(), [switch]$Quiet, [string]$InputText)
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if ($PSBoundParameters.ContainsKey("InputText")) { $lines = $InputText | & $File @Arguments 2>&1 }
        else { $lines = & $File @Arguments 2>&1 }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    $text = ($lines | ForEach-Object { "$_" }) -join "`n"
    if (-not $Quiet -and $text) { Write-Host $text }
    return [pscustomobject]@{ Code = $code; Text = $text }
}

# Runs a program in THIS console so the person can answer its questions (browser login, prompts...). Returns the exit code.
function Invoke-Interactive {
    param([string]$File, [string[]]$Arguments = @())
    $p = Start-Process -FilePath $File -ArgumentList $Arguments -NoNewWindow -Wait -PassThru
    return $p.ExitCode
}

function ConvertTo-PlainText([System.Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Ask-YesNo([string]$Question, [bool]$Default = $true) {
    $hint = if ($Default) { "[Y/n]" } else { "[y/N]" }
    $answer = (Read-Host "    $Question $hint").Trim().ToLower()
    if ($answer -eq "") { return $Default }
    return ($answer -eq "y" -or $answer -eq "yes")
}

function Ensure-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Warn "Node.js is not installed. It is needed to run the project."
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget -and (Ask-YesNo "Install Node.js LTS now with winget?" $true)) {
            Invoke-Interactive "winget" @("install", "--id", "OpenJS.NodeJS.LTS", "-e", "--accept-package-agreements", "--accept-source-agreements") | Out-Null
            Update-SessionPath
            $node = Get-Command node -ErrorAction SilentlyContinue
        }
        if (-not $node) { Stop-Setup "Install Node.js LTS from https://nodejs.org , then CLOSE this window, open a new PowerShell and run the command again." }
    }
    $version = (& node --version).Trim()
    $major = [int](($version -replace "^v", "").Split(".")[0])
    if ($major -lt 20) { Stop-Setup "Node.js $version is too old. Please install Node.js 20 or newer from https://nodejs.org" }
    Ok "Node.js $version"
}

# Writes a text file as UTF-8 WITHOUT the byte-order mark (wrangler's TOML reader dislikes the mark that Set-Content adds in Windows PowerShell 5).
function Write-Utf8([string]$Path, [string]$Text) {
    $full = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path (Get-Location).Path $Path }
    [IO.File]::WriteAllText($full, $Text, (New-Object Text.UTF8Encoding($false)))
}
