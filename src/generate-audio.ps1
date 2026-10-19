# Renders preview WAVs locally with Kokoro TTS (commercially safe, Apache-2.0).
#
# Inputs come from the App repo (LUMI-VOICE-LINES.md) and this project's
# work/listening-worklist.json. Output WAVs and manifest land in this project.
#
# Usage:  powershell -ExecutionPolicy Bypass -File src\generate-audio.ps1
param(
  [string]$LumiFile = '',
  [string]$ListeningWorklist = '',
  [string]$OutputDirectory = '',
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
$appRoot = if ($config) { $config.appRoot } else { '' }

if ([string]::IsNullOrWhiteSpace($LumiFile)) {
  if ([string]::IsNullOrWhiteSpace($appRoot)) {
    throw 'appRoot is not set in voicebuilder.config.json, so LUMI-VOICE-LINES.md cannot be found.'
  }
  $LumiFile = Join-Path $appRoot 'LUMI-VOICE-LINES.md'
}
if ([string]::IsNullOrWhiteSpace($ListeningWorklist)) {
  $ListeningWorklist = Join-Path $vbRoot 'work\listening-worklist.json'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $vbRoot 'work\samples'
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $vbRoot 'work\manifest.json'
}
if ($SampleRate -le 0) {
  $SampleRate = if ($config -and $config.sampleRate) { [int]$config.sampleRate } else { 11025 }
}

foreach ($requiredFile in @($LumiFile, $ListeningWorklist)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Required source file was not found: $requiredFile"
  }
}

# Build a combined worklist JSON for tts-kokoro.py
$audioItems = [System.Collections.Generic.List[object]]::new()

# System prompts (from App's audio-production/REFERENCE-LINES.md)
$systemPrompts = @(
    @{ id = 'excellent'; source = 'system-prompts'; day = $null; text = 'Excellent!' },
    @{ id = 'bingo'; source = 'system-prompts'; day = $null; text = 'Bingo!' },
    @{ id = 'good-try'; source = 'system-prompts'; day = $null; text = "Good try! Let's try again." },
    @{ id = 'thank-you-practicing'; source = 'system-prompts'; day = $null; text = 'Thank you for practicing with me today!' }
)
foreach ($sp in $systemPrompts) {
    $audioItems.Add([PSCustomObject]@{
        id = $sp.id
        source = $sp.source
        day = $sp.day
        text = $sp.text
    })
}

foreach ($line in [System.IO.File]::ReadAllLines($LumiFile, [System.Text.Encoding]::UTF8)) {
  if ($line -match '^\|\s*`(?<id>[^`]+)`\s*\|\s*(?<text>.+?)\s*\|\s*.*$') {
    $audioItems.Add([PSCustomObject]@{
      id = "lumi-$($Matches.id)"
      source = 'LUMI-VOICE-LINES.md'
      day = $null
      text = $Matches.text.Trim()
    })
  }
}
if ($audioItems.Count -eq 0) {
  throw 'No Lumi voice lines were found in LUMI-VOICE-LINES.md.'
}

$worklist = [System.IO.File]::ReadAllText($ListeningWorklist, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if (@($worklist).Count -eq 0) {
  throw 'The listening worklist contains no items.'
}
foreach ($entry in @($worklist)) {
  if (
    [string]::IsNullOrWhiteSpace($entry.id) -or
    [string]::IsNullOrWhiteSpace($entry.source) -or
    [string]::IsNullOrWhiteSpace($entry.text)
  ) {
    throw "Invalid listening worklist entry: $($entry.id)"
  }
  if ($entry.text -match '[\u2014\u2013]') {
    throw "Listening script still contains a dash that a speech voice would read badly: $($entry.id)"
  }
  $audioItems.Add([PSCustomObject]@{
    id = $entry.id
    source = $entry.source
    day = $entry.day
    text = $entry.text
  })
}

$duplicateIds = @($audioItems | Group-Object -Property id | Where-Object { $_.Count -gt 1 })
if ($duplicateIds.Count -gt 0) {
  throw "Duplicate audio IDs: $($duplicateIds.Name -join ', ')"
}

# Write combined worklist to temp file for tts-kokoro.py
$tempWorklist = Join-Path $env:TEMP "vb-tts-worklist-$([Guid]::NewGuid()).json"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempWorklist, (ConvertTo-Json -InputObject @($audioItems) -Depth 5), $utf8WithoutBom)

# Call Python Kokoro TTS
$pythonArgs = @(
  'src/tts-kokoro.py',
  '--worklist', $tempWorklist,
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

# Clean up temp worklist
Remove-Item -LiteralPath $tempWorklist -Force -ErrorAction SilentlyContinue

$totalBytes = (Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.wav' -File | Measure-Object -Property Length -Sum).Sum
Write-Output "Generated $($audioItems.Count) WAV previews with Kokoro TTS ($VoiceName)."
Write-Output "Total WAV size: $totalBytes bytes"
Write-Output "Audio folder: $OutputDirectory"
Write-Output "Manifest: $ManifestPath"
