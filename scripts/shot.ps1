param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Out = "shot.png",
  [string]$Size = "1600,900",
  [ValidateSet("gpu", "swiftshader", "none")][string]$Mode = "swiftshader",
  [switch]$ReducedMotion,
  [int]$VirtualTimeMs = 0,
  [string]$Query = "",
  [string]$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = "Stop"
$abs = (Resolve-Path -LiteralPath $Path).Path
$outAbs = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path (Get-Location).Path $Out }
$outDir = Split-Path -Parent $outAbs
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$tmpShot = Join-Path $env:TEMP ("pixel-shot-" + [guid]::NewGuid().ToString("N") + ".png")
$profile = Join-Path $env:TEMP ("pixel-profile-" + [guid]::NewGuid().ToString("N"))
$uri = [System.Uri]::new($abs).AbsoluteUri
if ($Query) { $uri += if ($Query.StartsWith("?")) { $Query } else { "?" + $Query } }

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
  "--user-data-dir=$profile",
  "--window-size=$Size",
  "--screenshot=$tmpShot"
)
if ($Mode -eq "swiftshader") { $argList += @("--enable-unsafe-swiftshader", "--use-angle=swiftshader") }
if ($Mode -eq "none") { $argList += "--disable-3d-apis" }
if ($ReducedMotion) { $argList += "--force-prefers-reduced-motion" }
if ($VirtualTimeMs -gt 0) { $argList += "--virtual-time-budget=$VirtualTimeMs" }
$argList += $uri

$argLine = ($argList | ForEach-Object { Quote-Arg $_ }) -join " "
$proc = Start-Process -FilePath $Chrome -ArgumentList $argLine -PassThru
$proc.WaitForExit(25000) | Out-Null
if (-not $proc.HasExited) {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 250
}

if (-not (Test-Path $tmpShot)) {
  throw "Chrome did not write a screenshot. Is another headless instance/profile running? Try a unique -Out and close stale headless processes."
}

Move-Item -Force -LiteralPath $tmpShot -Destination $outAbs
try { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue } catch {}

Write-Output (Resolve-Path -LiteralPath $outAbs).Path
