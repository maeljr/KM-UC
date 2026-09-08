<#
    reindex_rag.ps1 - refresh the RAG index from the docs folder.

    Incremental by default: only PDFs that are new or changed since the last
    run are processed, so this is cheap enough to run nightly. Pass -Full to
    rebuild everything (needed only after changing the embedding model).

        .\reindex_rag.ps1
        .\reindex_rag.ps1 -Full

    The API has to be up, so this waits for it rather than failing when it
    fires while the machine is still starting.
#>

param(
    [switch]$Full,
    [int]$WaitSeconds = 300
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# A FULL rebuild is a long job, so say so rather than letting it look hung.
# It is only needed after changing the embedding model; the nightly run is
# incremental and normally finishes in seconds.
if ($Full) {
    Write-Host "Full rebuild requested. If this is the FIRST build, use" -ForegroundColor Yellow
    Write-Host ".\rebuild_index_fast.ps1 instead - it also restarts the server" -ForegroundColor Yellow
    Write-Host "so the speed settings actually take effect." -ForegroundColor Yellow
}

$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("rag_reindex_{0}.log" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))

function Write-Log($message) {
    "$((Get-Date).ToString('HH:mm:ss'))  $message" | Tee-Object -FilePath $log -Append
}

$base = 'http://127.0.0.1:8001'

Write-Log "Waiting for the RAG API (up to $WaitSeconds s)..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $info = Invoke-RestMethod "$base/" -TimeoutSec 10
        $ready = $true
        Write-Log "API is up: $($info.pipeline_version), $($info.indexed_chunks) chunks."
        break
    } catch {
        Start-Sleep -Seconds 10
    }
}

if (-not $ready) {
    Write-Log "The RAG API never came up. Is HACA-RAG-Server running?"
    exit 1
}

if ($Full) {
    $url = "$base/reindex"
    Write-Log "Reindexing (FULL rebuild)..."
} else {
    $url = "$base/reindex?incremental=true"
    Write-Log "Reindexing (incremental - new and changed PDFs only)..."
}

try {
    # No client timeout: a full rebuild with OCR can legitimately take hours.
    $result = Invoke-RestMethod -Method Post $url -TimeoutSec 0
    Write-Log "Done. Collection now holds $($result.indexed_chunks) chunks."
} catch {
    Write-Log "Reindex FAILED: $_"
    exit 1
}

Get-ChildItem $logDir -Filter 'rag_reindex_*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit 0
