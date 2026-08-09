#Requires -Version 5.1
<#
.SYNOPSIS
  Stop the current SuperPoE2 dev process tree and start it again.

.DESCRIPTION
  The dev entrypoint starts Vite and Electron through concurrently. This
  script finds that tree through the Vite port and known dev command markers,
  so unrelated Electron applications are left running.
#>
[CmdletBinding()]
param(
  [int]$Port = 3000,
  [int]$WaitSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

function Write-Step {
  param([string]$Message)
  Write-Host ([Environment]::NewLine + "==> $Message") -ForegroundColor Cyan
}

function Get-ProcessSnapshot {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessId -gt 0 })
}

function Test-DevCommand {
  param([string]$CommandLine)

  @(
    'vite',
    'dev:renderer',
    'dev:electron',
    'concurrently',
    'ELECTRON_RENDERER_URL'
  ) | Where-Object {
    $CommandLine.IndexOf($_, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } | Select-Object -First 1
}

function Get-DevProcessIds {
  param(
    [Parameter(Mandatory = $true)][object[]]$Snapshot,
    [Parameter(Mandatory = $false)][int[]]$PortOwners = @()
  )

  $roots = New-Object 'System.Collections.Generic.HashSet[int]'

  foreach ($ownerId in $PortOwners) {
    $owner = $Snapshot | Where-Object { $_.ProcessId -eq $ownerId } | Select-Object -First 1
    if (-not $owner) { continue }

    $commandLine = [string]$owner.CommandLine
    $isNodeOrElectron = $owner.Name -match '^(node|electron)(\.exe)?$'
    if (-not ($isNodeOrElectron -and (Test-DevCommand -CommandLine $commandLine))) {
      continue
    }

    $current = $owner
    while ($current) {
      $currentId = [int]$current.ProcessId
      if ($currentId -eq $PID) { break }
      [void]$roots.Add($currentId)

      $parentId = [int]$current.ParentProcessId
      $parent = $Snapshot | Where-Object { $_.ProcessId -eq $parentId } | Select-Object -First 1
      if (-not $parent -or -not (Test-DevCommand -CommandLine ([string]$parent.CommandLine))) {
        break
      }
      $current = $parent
    }
  }

  $targets = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($rootId in $roots) {
    if ($rootId -ne $PID) { [void]$targets.Add($rootId) }
  }

  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $Snapshot) {
      $processId = [int]$process.ProcessId
      $parentId = [int]$process.ParentProcessId
      if ($targets.Contains($parentId) -and $processId -ne $PID -and $targets.Add($processId)) {
        $changed = $true
      }
    }
  }

  @($targets | ForEach-Object { [int]$_ })
}

function Get-ProcessDepth {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][object[]]$Snapshot,
    [Parameter(Mandatory = $true)][System.Collections.Generic.HashSet[int]]$TargetIds
  )

  $depth = 0
  $currentId = $ProcessId
  while ($true) {
    $process = $Snapshot | Where-Object { $_.ProcessId -eq $currentId } | Select-Object -First 1
    if (-not $process -or -not $TargetIds.Contains([int]$process.ParentProcessId)) {
      return $depth
    }
    $depth++
    $currentId = [int]$process.ParentProcessId
  }
}

function Stop-DevProcesses {
  param([int]$ListenPort)

  $connections = @(Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue)
  $portOwners = @($connections | ForEach-Object { [int]$_.OwningProcess } | Select-Object -Unique)
  $snapshot = Get-ProcessSnapshot
  $processIds = @(Get-DevProcessIds -Snapshot $snapshot -PortOwners $portOwners)

  if ($processIds.Count -eq 0) {
    Write-Host "No SuperPoE2 dev process found."
    if ($portOwners.Count -gt 0) {
      Write-Host "Port $ListenPort is owned by an unrelated process; it was not stopped." -ForegroundColor Yellow
    }
    return
  }

  $targetSet = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($processId in $processIds) { [void]$targetSet.Add([int]$processId) }

  $orderedIds = @($processIds | Sort-Object {
      Get-ProcessDepth -ProcessId ([int]$_) -Snapshot $snapshot -TargetIds $targetSet
    } -Descending)

  foreach ($processId in $orderedIds) {
    try {
      Stop-Process -Id ([int]$processId) -Force -ErrorAction Stop
      Write-Host "Stopped process $processId"
    } catch {
      Write-Host ("Could not stop process {0}: {1}" -f $processId, $_.Exception.Message) -ForegroundColor Yellow
    }
  }
}

Write-Step "Restart SuperPoE2 dev environment"
Write-Host "Repo root: $Root"
Stop-DevProcesses -ListenPort $Port

$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
  $stillListening = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($stillListening.Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if ($stillListening.Count -gt 0) {
  throw "Port $Port is still in use. Close the process using it and run this script again."
}

Write-Step "Start npm run dev"
npm.cmd run dev
exit $LASTEXITCODE
