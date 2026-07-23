[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$source = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Local Storage\leveldb'))
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'SuperPoE2'))
$localStorageRoot = Join-Path $appRoot 'Local Storage'
$target = Join-Path $localStorageRoot 'leveldb'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $localStorageRoot ("leveldb.backup-$timestamp")

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "Snapshot directory not found: $source"
}

$lockPath = Join-Path $target 'LOCK'
if (Test-Path -LiteralPath $lockPath) {
  $lockStream = $null
  try {
    $lockStream = [System.IO.File]::Open(
      $lockPath,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
  } catch {
    throw "Close SuperPoE2 before restoring. Its local storage is still in use."
  } finally {
    if ($lockStream) { $lockStream.Dispose() }
  }
}

New-Item -ItemType Directory -Path $localStorageRoot -Force | Out-Null

$movedCurrentData = $false
try {
  if (Test-Path -LiteralPath $target) {
    Move-Item -LiteralPath $target -Destination $backup
    $movedCurrentData = $true
    Write-Host "Current data backed up to: $backup"
  }

  Copy-Item -LiteralPath $source -Destination $target -Recurse
  Write-Host "SuperPoE2 local storage restored from: $source"
  Write-Host "Start the desktop application to verify the saved builds."
} catch {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  if ($movedCurrentData -and (Test-Path -LiteralPath $backup)) {
    Move-Item -LiteralPath $backup -Destination $target
  }
  throw
}
