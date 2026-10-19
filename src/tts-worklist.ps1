# Compatibility wrapper: delegates to src/tts-kokoro.py (Kokoro TTS, Apache-2.0).
#
# This script exists for backward compatibility. New code should call
# `python src/tts-kokoro.py` directly.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File src\tts-worklist.ps1 `
#     -Worklist work\docs\my-article\worklist.json `
#     -OutputDirectory work\docs\my-article\samples `
#     [-VoiceName af_heart] [-SampleRate 11025] [-ManifestPath ...]
param(
  [Parameter(Mandatory = $true)][string]$Worklist,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$ManifestPath = '',
  [string]$VoiceName = 'af_heart',
  [int]$SampleRate = 0,
  [string]$ConfigPath = ''
)

$ErrorActionPreference = 'Stop'
$vbRoot = Split-Path -Parent $PSScriptRoot

function Read-Config([string]$path) {
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $vbRoot 'voicebuilder.config.json'
}
$config = Read-Config $ConfigPath

if (-not (Test-Path -LiteralPath $Worklist -PathType Leaf)) {
  throw "Worklist was not found: $Worklist"
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($OutputDirectory))) 'manifest.json'
}
if ($SampleRate -le 0) {
  $SampleRate = if ($config -and $config.sampleRate) { [int]$config.sampleRate } else { 11025 }
}

$pythonArgs = @(
  'src/tts-kokoro.py',
  '--worklist', $Worklist,
  '--output', $OutputDirectory,
  '--manifest', $ManifestPath,
  '--voice', $VoiceName,
  '--sample-rate', $SampleRate
)

Write-Output "Generating samples with Kokoro TTS (voice: $VoiceName)..."
$exitCode = & python $pythonArgs
if ($exitCode -ne 0) {
  throw "Kokoro TTS failed with exit code $exitCode"
}

$totalBytes = (Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.wav' -File | Measure-Object -Property Length -Sum).Sum
Write-Output "Generated WAV samples with Kokoro TTS ($VoiceName)."
Write-Output "Total WAV size: $totalBytes bytes"
Write-Output "Samples folder: $OutputDirectory"
Write-Output "Manifest: $ManifestPath"
