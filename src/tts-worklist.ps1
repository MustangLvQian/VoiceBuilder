# Renders preview WAVs for an arbitrary worklist with a Windows SAPI voice.
#
# src/generate-audio.ps1 is hard-wired to the App's two sources (the Lumi lines
# and the listening worklist). Document topics are neither, so they get their
# own small renderer that takes any worklist.json and any output folder - the
# SAPI voice setup and the 11 kHz / 16-bit / mono format are the same, which is
# what keeps the samples byte-compatible with the rest of the pipeline.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File src\tts-worklist.ps1 `
#     -Worklist work\docs\my-article\worklist.json `
#     -OutputDirectory work\docs\my-article\samples
param(
  [Parameter(Mandatory = $true)][string]$Worklist,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
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

if (-not (Test-Path -LiteralPath $Worklist -PathType Leaf)) {
  throw "Worklist was not found: $Worklist"
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  # Loose convention: the manifest sits one level above the samples folder.
  # GetFullPath rather than Resolve-Path: the samples folder may not exist yet.
  $ManifestPath = Join-Path ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($OutputDirectory))) 'manifest.json'
}
if ([string]::IsNullOrWhiteSpace($VoiceName)) {
  $VoiceName = if ($config -and $config.ttsVoice) { $config.ttsVoice } else { 'Microsoft Zira Desktop' }
}
if ($SampleRate -le 0) {
  $SampleRate = if ($config -and $config.sampleRate) { [int]$config.sampleRate } else { 11025 }
}

# 注意（PS 5.1 实测的两个坑）：
# 1. 不能用 $worklist 作局部变量——PS 变量名大小写不敏感，会和参数 $Worklist 撞名，
#    导致赋值拿到未解析的原始字符串而不是 ConvertFrom-Json 的结果。
# 2. 本文件含中文注释，必须存成带 BOM 的 UTF-8；PS 5.1 对无 BOM 文件按 ANSI(CP936)
#    解码，多字节注释会静默破坏分词（表现为结果为 $null、报错行号错位）。
$rawWorklist = [System.IO.File]::ReadAllText($Worklist, [System.Text.Encoding]::UTF8)
$worklistData = $rawWorklist | ConvertFrom-Json
if (@($worklistData).Count -eq 0) {
  throw "The worklist contains no items: $Worklist"
}

$items = [System.Collections.Generic.List[object]]::new()
foreach ($entry in @($worklistData)) {
  if ([string]::IsNullOrWhiteSpace($entry.id) -or [string]::IsNullOrWhiteSpace($entry.text)) {
    throw "Invalid worklist entry: $($entry.id)"
  }
  $items.Add($entry)
}
$duplicateIds = @($items | Group-Object -Property id | Where-Object { $_.Count -gt 1 })
if ($duplicateIds.Count -gt 0) {
  throw "Duplicate audio IDs: $($duplicateIds.Name -join ', ')"
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

  # Same 11 kHz / 16-bit / mono the recordings use, so a sample and a take are
  # always directly comparable.
  $audioFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    $SampleRate,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )

  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $ManifestPath) -Force | Out-Null
  $manifest = [System.Collections.Generic.List[object]]::new()
  foreach ($item in $items) {
    $fileName = "$($item.id).wav"
    $filePath = Join-Path $OutputDirectory $fileName
    # Article text legitimately contains em/en dashes, but SAPI pauses oddly on
    # them and some voices read the glyph. Speak them as a comma; keep the
    # worklist's own text untouched so the page still shows what was written.
    $speakText = [string]$item.text
    $speakText = $speakText -replace '[\u2014\u2013]', ', '
    $speakText = $speakText -replace '[\u2018\u2019]', "'"
    $speakText = $speakText -replace '[\u201c\u201d]', '"'
    $speakText = $speakText -replace '\u2026', ', '
    $synthesizer.SetOutputToWaveFile($filePath, $audioFormat)
    $synthesizer.Speak($speakText)
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

  $totalBytes = (Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.wav' -File | Measure-Object -Property Length -Sum).Sum
  Write-Output "Generated $($manifest.Count) WAV previews with $VoiceName."
  Write-Output "Total WAV size: $totalBytes bytes"
  Write-Output "Samples folder: $OutputDirectory"
  Write-Output "Manifest: $ManifestPath"
}
finally {
  $synthesizer.SetOutputToNull()
  $synthesizer.Dispose()
}
