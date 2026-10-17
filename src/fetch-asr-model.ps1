# Downloads the offline English ASR model used by src/asr-verify.py.
#
# ~41 MB zipped (71 MB unpacked), kept out of git. Run once per machine; resumes
# a partial download.
#
# Usage:  powershell -ExecutionPolicy Bypass -File src\fetch-asr-model.ps1

$ErrorActionPreference = 'Stop'
$vbRoot = Split-Path -Parent $PSScriptRoot
$modelName = 'vosk-model-small-en-us-0.15'
$modelsDir = Join-Path $vbRoot 'models'
$target = Join-Path $modelsDir $modelName
$url = "https://alphacephei.com/vosk/models/$modelName.zip"

if ((Test-Path -LiteralPath (Join-Path $target 'am'))) {
  Write-Output "Model already present: $target"
  exit 0
}

New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
$zip = Join-Path $modelsDir "$modelName.zip"

Write-Output "Downloading $url"
Write-Output "(~41 MB; the host is slow from some networks, the download resumes if interrupted)"
& curl.exe -L --fail --continue-at - --retry 8 --retry-delay 5 -o $zip $url
if ($LASTEXITCODE -ne 0) { throw "curl failed with exit code $LASTEXITCODE" }

Write-Output "Extracting..."
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $modelsDir -Force
Remove-Item -LiteralPath $zip -Force

Write-Output "Model ready: $target"
