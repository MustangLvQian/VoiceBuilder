# Packs the finished WAVs into the App's WeChat mini-program subpackages and
# writes the packaged manifest the App requires.
#
# This is the "hand it to the App" step for the mini program. It reads this
# project's work/manifest.json + work/audio and writes into the App repo:
#   <appRoot>/wechat-miniprogram/subpackages/audio-preview-0*/**.wav
#   <appRoot>/wechat-miniprogram/content/audio-preview-manifest.json (+ .json.js)
#
# Usage:  powershell -ExecutionPolicy Bypass -File src\pack-miniprogram.ps1
param(
  [string]$WorkManifest = '',
  [string]$AudioDir = '',
  [string]$MiniProgramRoot = '',
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

if ([string]::IsNullOrWhiteSpace($WorkManifest)) { $WorkManifest = Join-Path $vbRoot 'work\manifest.json' }
if ([string]::IsNullOrWhiteSpace($AudioDir)) { $AudioDir = Join-Path $vbRoot 'work\audio' }
if ([string]::IsNullOrWhiteSpace($MiniProgramRoot)) {
  if ([string]::IsNullOrWhiteSpace($appRoot)) {
    throw 'appRoot is not set in voicebuilder.config.json, so the mini program root cannot be found.'
  }
  $MiniProgramRoot = Join-Path $appRoot 'wechat-miniprogram'
}

$sourceManifest = [System.IO.File]::ReadAllText($WorkManifest, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if (@($sourceManifest).Count -eq 0) {
  throw 'The audio manifest contains no assets.'
}

$items = @(
  foreach ($entry in $sourceManifest) {
    if (
      [string]::IsNullOrWhiteSpace($entry.id) -or
      $entry.file -notmatch '^[A-Za-z0-9._-]+\.wav$' -or
      [string]::IsNullOrWhiteSpace($entry.source) -or
      [string]::IsNullOrWhiteSpace($entry.text) -or
      $entry.status -ne 'local-generated-unreviewed'
    ) {
      throw "Invalid audio entry: $($entry.id)"
    }
    $sourcePath = Join-Path $AudioDir $entry.file
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "Audio file is missing: $sourcePath"
    }
    [PSCustomObject]@{ Entry = $entry; Bytes = (Get-Item -LiteralPath $sourcePath).Length }
  }
)
if (@($items.Entry.id | Select-Object -Unique).Count -ne $items.Count) {
  throw 'Audio IDs must be unique.'
}

$packageLimitBytes = 1900000
$packages = [System.Collections.Generic.List[object]]::new()
foreach ($item in ($items | Sort-Object @{ Expression = 'Bytes'; Descending = $true }, @{ Expression = { $_.Entry.file }; Ascending = $true })) {
  $package = $null
  foreach ($candidate in $packages) {
    if ($candidate.Bytes + $item.Bytes -le $packageLimitBytes) {
      $package = $candidate
      break
    }
  }
  if ($null -eq $package) {
    $number = $packages.Count + 1
    $package = [PSCustomObject]@{
      Root = 'subpackages/audio-preview-{0:d2}' -f $number
      Bytes = 0
      Items = [System.Collections.Generic.List[object]]::new()
    }
    $packages.Add($package)
  }
  $package.Items.Add($item)
  $package.Bytes += $item.Bytes
}

$appConfigPath = Join-Path $MiniProgramRoot 'app.json'
$appConfig = [System.IO.File]::ReadAllText($appConfigPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$configuredRoots = @($appConfig.subPackages | ForEach-Object { $_.root })
if ($packages.Count -gt $configuredRoots.Count) {
  throw "The audio assets need $($packages.Count) subpackages, but app.json configures only $($configuredRoots.Count)."
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$miniManifest = [System.Collections.Generic.List[object]]::new()
$rootByFile = @{}
for ($index = 0; $index -lt $configuredRoots.Count; $index++) {
  $root = $configuredRoots[$index]
  $packagePath = Join-Path $MiniProgramRoot $root
  $pagePath = Join-Path $packagePath 'pages\placeholder'
  New-Item -ItemType Directory -Path $pagePath -Force | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $pagePath 'index.js'), 'Page({})', $utf8WithoutBom)
  [System.IO.File]::WriteAllText((Join-Path $pagePath 'index.json'), '{"navigationBarTitleText":"Audio assets"}', $utf8WithoutBom)
  [System.IO.File]::WriteAllText((Join-Path $pagePath 'index.wxml'), '<view>Internal audio resource package.</view>', $utf8WithoutBom)

  $package = $packages | Where-Object { $_.Root -eq $root } | Select-Object -First 1
  $expectedFiles = @()
  if ($package) {
    $expectedFiles = @($package.Items | ForEach-Object { $_.Entry.file })
  }
  foreach ($oldAudio in (Get-ChildItem -LiteralPath $packagePath -Filter '*.wav' -File -ErrorAction SilentlyContinue)) {
    if ($oldAudio.Name -notin $expectedFiles) {
      Remove-Item -LiteralPath $oldAudio.FullName -Force
    }
  }
  if (-not $package) { continue }

  foreach ($item in $package.Items) {
    $entry = $item.Entry
    $destinationPath = Join-Path $packagePath $entry.file
    Copy-Item -LiteralPath (Join-Path $AudioDir $entry.file) -Destination $destinationPath -Force
    $rootByFile[$entry.file] = $root
  }
}

foreach ($entry in $sourceManifest) {
  $root = $rootByFile[$entry.file]
  if ([string]::IsNullOrWhiteSpace($root)) {
    throw "Audio file was not assigned to a configured subpackage: $($entry.file)"
  }
  $miniManifest.Add([PSCustomObject]@{
    id = $entry.id
    file = $entry.file
    source = $entry.source
    day = $entry.day
    text = $entry.text
    voice = $entry.voice
    locale = $entry.locale
    status = $entry.status
    subpackageRoot = $root
    src = "$root/$($entry.file)"
  })
}

foreach ($root in $configuredRoots) {
  $packagePath = Join-Path $MiniProgramRoot $root
  $packageBytes = (Get-ChildItem -LiteralPath $packagePath -Recurse -File | Measure-Object -Property Length -Sum).Sum
  if ($packageBytes -gt 2000000) {
    throw "Subpackage $root is $packageBytes bytes; reduce it below 2,000,000 bytes."
  }
}

$outputManifestPath = Join-Path $MiniProgramRoot 'content\audio-preview-manifest.json'
# ConvertTo-Json on Windows emits CRLF; the App keeps these files LF so the diff
# stays clean across machines. Normalise before writing.
$manifestJson = (ConvertTo-Json -InputObject @($miniManifest) -Depth 6) -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($outputManifestPath, $manifestJson, $utf8WithoutBom)

# The mini program's require() cannot load a .json file: it resolves the module
# as <name>.json.js and fails with "module ... is not defined" when no such file
# exists. Every question bank ships a sibling wrapper for this reason. The JSON
# text is reused verbatim so the two files never drift. (docs/pitfalls.md MP-01)
[System.IO.File]::WriteAllText(
  "$outputManifestPath.js",
  "module.exports = $manifestJson;`n",
  $utf8WithoutBom
)

$totalAudioBytes = ($items | Measure-Object -Property Bytes -Sum).Sum
Write-Output "Packed $($miniManifest.Count) audio files into $($packages.Count) subpackages."
Write-Output "Audio size: $totalAudioBytes bytes; each configured subpackage is below 2,000,000 bytes."
Write-Output "Mini program manifest: $outputManifestPath"
