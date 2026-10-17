# Renders preview WAVs locally with a Windows SAPI voice (TTS).
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
  [string]$VoiceName = '',
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
  $OutputDirectory = Join-Path $vbRoot 'work\audio'
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $vbRoot 'work\manifest.json'
}
if ([string]::IsNullOrWhiteSpace($VoiceName)) {
  $VoiceName = if ($config -and $config.ttsVoice) { $config.ttsVoice } else { 'Microsoft Zira Desktop' }
}
if ($SampleRate -le 0) {
  $SampleRate = if ($config -and $config.sampleRate) { [int]$config.sampleRate } else { 11025 }
}

foreach ($requiredFile in @($LumiFile, $ListeningWorklist)) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Required source file was not found: $requiredFile"
  }
}

Add-Type -AssemblyName System.Speech
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = $synthesizer.GetInstalledVoices() |
    Where-Object {
      $_.Enabled -and
      $_.VoiceInfo.Name -eq $VoiceName -and
      $_.VoiceInfo.Culture.Name -eq 'en-US' -and
      $_.VoiceInfo.Gender -eq [System.Speech.Synthesis.VoiceGender]::Female
    } |
    Select-Object -First 1
  if ($null -eq $voice) {
    throw "The requested enabled en-US female voice '$VoiceName' is not installed."
  }

  $synthesizer.SelectVoice($VoiceName)
  $synthesizer.Rate = -1
  $synthesizer.Volume = 100

  # 11 kHz / 16-bit mono keeps every line listenable while halving the size,
  # which matters because the WeChat mini program caps all packages combined at
  # 20 MB and each audio subpackage must stay under 2 MB.
  $audioFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    $SampleRate,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )

  $audioItems = [System.Collections.Generic.List[object]]::new()
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

  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $ManifestPath) -Force | Out-Null
  $manifest = [System.Collections.Generic.List[object]]::new()
  foreach ($item in $audioItems) {
    $fileName = "$($item.id).wav"
    $filePath = Join-Path $OutputDirectory $fileName
    $synthesizer.SetOutputToWaveFile($filePath, $audioFormat)
    $synthesizer.Speak($item.text)
    $synthesizer.SetOutputToNull()

    $manifest.Add([PSCustomObject]@{
      id = $item.id
      file = $fileName
      source = $item.source
      day = $item.day
      text = $item.text
      voice = $VoiceName
      locale = 'en-US'
      status = 'local-generated-unreviewed'
    })
  }

  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($ManifestPath, (ConvertTo-Json -InputObject @($manifest) -Depth 5), $utf8WithoutBom)

  $listeningCount = @($manifest | Where-Object { $_.source -ne 'LUMI-VOICE-LINES.md' }).Count
  $totalBytes = (Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.wav' -File | Measure-Object -Property Length -Sum).Sum
  Write-Output "Generated $($manifest.Count) local WAV previews with $VoiceName."
  Write-Output "Lumi lines: $(@($manifest | Where-Object { $_.source -eq 'LUMI-VOICE-LINES.md' }).Count)"
  Write-Output "Listening stimuli: $listeningCount"
  Write-Output "Total WAV size: $totalBytes bytes"
  Write-Output "Audio folder: $OutputDirectory"
  Write-Output "Manifest: $ManifestPath"
}
finally {
  $synthesizer.SetOutputToNull()
  $synthesizer.Dispose()
}
