# Downloads a pre-trained RVC model for American English accent conversion.
# ⚠️ DEPRECATED: RVC has licensing risks (fairseq GPL, model weights unclear).
# This script is kept for reference only. Use Kokoro TTS (Apache-2.0) instead.
#
# RVC (Retrieval-based Voice Conversion) models are hosted on Hugging Face.
# This script downloads a small, fast model suitable for CPU inference.
#
# Usage:  powershell -ExecutionPolicy Bypass -File src\fetch-rvc-model.ps1
#
# The model will be placed at: models/rvc/american-english.pth
# Requires: Python 3.10+, torch, fairseq (Python ≤3.10) or fairseq-fixed (Python 3.11+)

$ErrorActionPreference = 'Stop'
$vbRoot = Split-Path -Parent $PSScriptRoot
$modelsDir = Join-Path $vbRoot 'models'
$rvcDir = Join-Path $modelsDir 'rvc'
$modelName = 'american-english'
$target = Join-Path $rvcDir "$modelName.pth"

Write-Warning "⚠️ RVC is DEPRECATED due to licensing concerns (fairseq GPL, model weights unclear)."
Write-Warning "   Use 'npm run tts' (Kokoro TTS, Apache-2.0) for commercially safe American English samples."
Write-Warning "   This script will exit without downloading."

exit 1

# Recommended: a small v2 model trained on LibriSpeech / VCTK US speakers
# Source: https://huggingface.co/lj1995/VoiceConversionWebUI/tree/main
# We use a compact model (~50 MB) for faster CPU inference.
$url = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/pretrained_v2/f0G40k.pth"
$indexUrl = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/pretrained_v2/added_IVF1063_F0_nsf.pth"

# Also need hubert_base.pt for content encoding
$hubertUrl = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt"

if ((Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath (Join-Path $rvcDir 'hubert_base.pt'))) {
  Write-Output "RVC model already present: $target"
  exit 0
}

New-Item -ItemType Directory -Path $rvcDir -Force | Out-Null

Write-Output "Downloading RVC model (~50 MB)..."
Write-Output "This model converts various English accents to General American."
& curl.exe -L --fail --continue-at - --retry 8 --retry-delay 5 -o $target $url
if ($LASTEXITCODE -ne 0) { throw "curl failed downloading model: exit code $LASTEXITCODE" }

Write-Output "Downloading feature index (~15 MB)..."
$indexPath = Join-Path $rvcDir 'added_IVF1063_F0_nsf.pth'
& curl.exe -L --fail --continue-at - --retry 8 --retry-delay 5 -o $indexPath $indexUrl
if ($LASTEXITCODE -ne 0) { Write-Warning "Index download failed (optional for quality); continuing..." }

Write-Output "Downloading HuBERT base (~350 MB)..."
$hubertPath = Join-Path $rvcDir 'hubert_base.pt'
& curl.exe -L --fail --continue-at - --retry 8 --retry-delay 5 -o $hubertPath $hubertUrl
if ($LASTEXITCODE -ne 0) { throw "curl failed downloading HuBERT: exit code $LASTEXITCODE" }

Write-Output ""
Write-Output "RVC model ready: $target"
Write-Output "HuBERT ready:    $hubertPath"
Write-Output ""
Write-Output "To use accent conversion in '一键收尾', run:"
Write-Output "  python src/process-audio.py --rvc-model models/rvc/american-english.pth --device cpu"
Write-Output ""
Write-Output "Requirements (Python 3.10+):"
Write-Output "  pip install torch torchaudio noisereduce pydub scipy numpy soundfile pyloudnorm resampy"
Write-Output "  # For RVC accent conversion, install ONE of:"
Write-Output "  #   Python ≤3.10: pip install fairseq"
Write-Output "  #   Python 3.11/3.12: pip install fairseq-fixed"
Write-Output ""
Write-Output "For GPU acceleration (CUDA):"
Write-Output "  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121"