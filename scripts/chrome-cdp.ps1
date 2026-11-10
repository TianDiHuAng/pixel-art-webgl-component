param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Port = 9555,
  [string]$Size = "1600,900",
  [ValidateSet("gpu", "swiftshader", "none")][string]$Mode = "swiftshader",
  [switch]$ReducedMotion,
  [string]$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"
$abs = (Resolve-Path -LiteralPath $Path).Path
$uri = [System.Uri]::new($abs).AbsoluteUri
$profile = Join-Path $env:TEMP ("pixel-cdp-" + [guid]::NewGuid().ToString("N"))

function Quote-Arg([string]$s) {
  if ($s -match '[\s"]') { return '"' + ($s -replace '"', '\"') + '"' }
  return $s
}

$argList = @(
  "--headless=new",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profile",
  "--window-size=$Size"
)
if ($Mode -eq "swiftshader") { $argList += @("--enable-unsafe-swiftshader", "--use-angle=swiftshader") }
if ($Mode -eq "none") { $argList += "--disable-3d-apis" }
if ($ReducedMotion) { $argList += "--force-prefers-reduced-motion" }
$argList += $uri

$argLine = ($argList | ForEach-Object { Quote-Arg $_ }) -join " "
$proc = Start-Process -FilePath $Chrome -ArgumentList $argLine -PassThru

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    $list = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2
    if ($list) { $ready = $true; break }
  } catch {}
}

if (-not $ready) {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw "Chrome CDP did not become ready on port $Port."
}

[pscustomobject]@{
  pid = $proc.Id
  port = $Port
  profile = $profile
  url = $uri
  mode = $Mode
  reduced = [bool]$ReducedMotion
} | ConvertTo-Json -Compress

# When finished with the probe:
#   Stop-Process -Id <pid> -Force
#   Remove-Item -Recurse -Force <profile>
