#Requires -Version 5.1
<#
.SYNOPSIS
  One-click local setup and Electron package build for SuperPoE2 (Windows).

.DESCRIPTION
  - Clone or fast-forward update read-only upstreams under upstreams/
  - npm install
  - Optional resource pipeline (public/ is already committed; only needed when refreshing upstream data)
  - Build and test the pinned native LuaJIT sidecar
  - npm run dist:electron  (local installer / package)

.PARAMETER SkipUpstreams
  Do not clone or update upstreams/ (frontend package only).

.PARAMETER SkipInstall
  Skip npm install.

.PARAMETER SkipPackage
  Stop after deps (and optional pipeline); do not run electron-builder.

.PARAMETER WithPipeline
  After updating upstreams, run npm run pipeline:all -- <TreeVersion>.

.PARAMETER TreeVersion
  Tree version for WithPipeline. Default: 0_5.

.EXAMPLE
  .\scripts\build-local.ps1

.EXAMPLE
  .\scripts\build-local.ps1 -SkipUpstreams

.EXAMPLE
  .\scripts\build-local.ps1 -WithPipeline -TreeVersion 0_5
#>
[CmdletBinding()]
param(
  [switch]$SkipUpstreams,
  [switch]$SkipInstall,
  [switch]$SkipPackage,
  [switch]$WithPipeline,
  [string]$TreeVersion = "0_5"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Clear-BuildArtifacts {
  # electron-builder writes installers to release/; old layouts left win-unpacked* under dist/.
  $targets = @(
    (Join-Path $Root "release"),
    (Join-Path $Root "dist\win-unpacked"),
    (Join-Path $Root "dist\win-unpacked.tmp")
  )
  foreach ($path in $targets) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
      Write-Host "Removed $path"
    } catch {
      Write-Host "Warning: could not remove $path ($($_.Exception.Message)). Close SuperPoE2/Electron if it is running, or reboot and delete it manually." -ForegroundColor Yellow
    }
  }
}


function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found in PATH: $Name"
  }
}

function Ensure-UpstreamRepo {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $gitDir = Join-Path $Path ".git"
  if (Test-Path $gitDir) {
    Write-Host "Updating $Path ..."
    git -C $Path pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      throw "git pull --ff-only failed for $Path (local commits or dirty state?). Resolve manually, then re-run."
    }
    return
  }

  if (Test-Path $Path) {
    throw "Directory exists but is not a git repository: $Path. Remove it or init manually."
  }

  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  Write-Host "Cloning $Url -> $Path ..."
  git clone $Url $Path
  if ($LASTEXITCODE -ne 0) {
    throw "git clone failed: $Url"
  }
}

Write-Step "SuperPoE2 local build (Windows)"
Write-Host "Repo root: $Root"

Assert-Command git
Assert-Command npm
Assert-Command node

if (-not $SkipUpstreams) {
  Write-Step "Clone / update upstreams (read-only, gitignored)"
  Ensure-UpstreamRepo `
    -Url "https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git" `
    -Path (Join-Path $Root "upstreams\PathOfBuilding-PoE2")
  Ensure-UpstreamRepo `
    -Url "https://github.com/Chuanhsing/PoeCharm2.git" `
    -Path (Join-Path $Root "upstreams\PoeCharm2")
  Ensure-UpstreamRepo `
    -Url "https://github.com/maxensas/xiletrade.git" `
    -Path (Join-Path $Root "upstreams\Xiletrade")
} else {
  Write-Step "Skipping upstreams (-SkipUpstreams)"
}

if (-not $SkipInstall) {
  Write-Step "npm install"
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
} else {
  Write-Step "Skipping npm install (-SkipInstall)"
}

if ($WithPipeline) {
  if ($SkipUpstreams) {
    throw "-WithPipeline requires upstreams. Remove -SkipUpstreams."
  }
  Write-Step "Resource pipeline: npm run pipeline:all -- $TreeVersion"
  # pipeline:check is recommended but not hard-required here; surface failures clearly.
  npm run pipeline:all -- $TreeVersion
  if ($LASTEXITCODE -ne 0) { throw "pipeline:all failed" }
}

if (-not $SkipPackage) {
  Write-Step "Clear previous package artifacts"
  Clear-BuildArtifacts
  Write-Step "Build local Electron package (npm run dist:electron)"
  npm run dist:electron
  if ($LASTEXITCODE -ne 0) { throw "dist:electron failed" }
  Write-Host ""
  Write-Host "Done. Installer artifacts under release/ (or directories.output / electron-builder --config). Renderer dist/, main dist-electron/." -ForegroundColor Green
} else {
  Write-Step "Skipping package (-SkipPackage)"
  Write-Host "Done (setup only)." -ForegroundColor Green
}
