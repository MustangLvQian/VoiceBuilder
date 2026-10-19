# Renders preview WAVs locally with Windows SAPI (built-in, no model downloads).
# Uses the recording worklist (work/recording-worklist.json) as source.
# Output WAVs go to work/samples/ and manifest to work/manifest.json

param(
  [string]$WorklistPath = '',
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

if ([string]::IsNullOrWhiteSpace($WorklistPath)) {
  $WorklistPath = Join-Path $vbRoot 'work\recording-worklist.json'
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $vbRoot 'work\samples'
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

if (-not (Test-Path -LiteralPath $WorklistPath -PathType Leaf)) {
  throw "Worklist not found: $WorklistPath"
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
    # Fallback: any enabled en-US voice
    $voice = $synthesizer.GetInstalledVoices() |
      Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' } |
      Select-Object -First 1
    if ($null -eq $voice) {
      throw "No enabled en-US voice found. Installed voices: $($synthesizer.GetInstalledVoices().VoiceInfo.Name -join ', ')"
    }
    Write-Warning "Voice '$VoiceName' not found, using '$($voice.VoiceInfo.Name)' instead."
  }

  $synthesizer.SelectVoice($voice.VoiceInfo.Name)
  $synthesizer.Rate = -1
  $synthesizer.Volume = 100

  $audioFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    $SampleRate,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )

  $worklist = [System.IO.File]::ReadAllText($WorklistPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  if (@($worklist).Count -eq 0) {
    throw 'The worklist contains no items.'
  }

  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $ManifestPath) -Force | Out-Null

  function Normalize-And-TrimWav([string]$Path, [int]$Rate) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -le 46) { return }
    # SAPI writes an 18-byte fmt chunk (with 2-byte cbSize = 0), placing the
    # 'data' chunk header at offset 38 and PCM samples at offset 46.
    # Convert to canonical 44-byte WAV header (16-byte fmt chunk) and trim silence.
    $dataOffset = if (
      [System.Text.Encoding]::ASCII.GetString($bytes, 38, 4) -eq 'data'
    ) { 46 } elseif (
      [System.Text.Encoding]::ASCII.GetString($bytes, 36, 4) -eq 'data'
    ) { 44 } else { return }

    $dataBytes = $bytes.Length - $dataOffset
    $sampleCount = [int][Math]::Floor($dataBytes / 2)
    if ($sampleCount -le 0) { return }
    $start = 0
    while ($start -lt $sampleCount) {
      $val = [System.BitConverter]::ToInt16($bytes, $dataOffset + ($start * 2))
      if ([Math]::Abs([int]$val) -ge 25) { break }
      $start++
    }
    $end = $sampleCount - 1
    while ($end -gt $start) {
      $val = [System.BitConverter]::ToInt16($bytes, $dataOffset + ($end * 2))
      if ([Math]::Abs([int]$val) -ge 25) { break }
      $end--
    }
    $pad = [int][Math]::Round($Rate * 0.10)
    $minSamples = [int][Math]::Ceiling($Rate * 0.55)
    $newStart = [Math]::Max(0, $start - $pad)
    $newEnd = [Math]::Min($sampleCount - 1, $end + $pad)
    $newCount = $newEnd - $newStart + 1
    if ($newCount -lt $minSamples) {
      $extra = $minSamples - $newCount
      $newEnd = [Math]::Min($sampleCount - 1, $newEnd + $extra)
      $newCount = $newEnd - $newStart + 1
    }
    $newDataBytes = $newCount * 2
    $out = New-Object byte[] (44 + $newDataBytes)
    [System.Array]::Copy([System.Text.Encoding]::ASCII.GetBytes('RIFF'), 0, $out, 0, 4)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint32](36 + $newDataBytes)), 0, $out, 4, 4)
    [System.Array]::Copy([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '), 0, $out, 8, 8)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]16), 0, $out, 16, 4)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint16]1), 0, $out, 20, 2)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint16]1), 0, $out, 22, 2)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$Rate), 0, $out, 24, 4)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]($Rate * 2)), 0, $out, 28, 4)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint16]2), 0, $out, 32, 2)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint16]16), 0, $out, 34, 2)
    [System.Array]::Copy([System.Text.Encoding]::ASCII.GetBytes('data'), 0, $out, 36, 4)
    [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$newDataBytes), 0, $out, 40, 4)
    [System.Array]::Copy($bytes, $dataOffset + ($newStart * 2), $out, 44, $newDataBytes)
    [System.IO.File]::WriteAllBytes($Path, $out)
  }

  $manifest = [System.Collections.Generic.List[object]]::new()
  $generated = 0
  $skipped = 0

  foreach ($item in $worklist) {
    $fileName = "$($item.id).wav"
    $filePath = Join-Path $OutputDirectory $fileName

    # Skip if already exists
    if (Test-Path -LiteralPath $filePath -PathType Leaf) {
      Write-Host "  [SKIP] $fileName (already exists)"
      $skipped++
    } else {
      Write-Host "  [GEN]  $fileName"
      $synthesizer.SetOutputToWaveFile($filePath, $audioFormat)
      $synthesizer.Speak($item.text)
      $synthesizer.SetOutputToNull()
      Normalize-And-TrimWav -Path $filePath -Rate $SampleRate
      $generated++
    }

    $manifest.Add([PSCustomObject]@{
      id = $item.id
      file = $fileName
      source = $item.source
      day = $item.day
      text = $item.text
      voice = $voice.VoiceInfo.Name
      locale = 'en-US'
      status = 'local-generated-unreviewed'
    })
  }

  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($ManifestPath, (ConvertTo-Json -InputObject @($manifest) -Depth 5), $utf8WithoutBom)

  $totalBytes = (Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.wav' -File | Measure-Object -Property Length -Sum).Sum
  Write-Output "=========================================="
  Write-Output "Generated: $generated, Skipped: $skipped, Total in manifest: $($manifest.Count)"
  Write-Output "Audio folder: $OutputDirectory"
  Write-Output "Manifest: $ManifestPath"
  Write-Output "Total WAV size: $totalBytes bytes"
}
finally {
  $synthesizer.SetOutputToNull()
  $synthesizer.Dispose()
}