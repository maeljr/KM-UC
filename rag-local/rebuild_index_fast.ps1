<#
    rebuild_index_fast.ps1 - build the RAG index, quickly, in one command.

    Run this ONCE now. After it, the nightly incremental reindex takes seconds
    and you never do this again unless you change the embedding model.

        cd C:\chunk\rag-local
        .\rebuild_index_fast.ps1

    What it does, in order:

      1. Stops any RAG server that is already running. This matters more than
         it sounds: a running Python process holds its code in memory, so the
         speed fixes do nothing until it is restarted.
      2. Installs pymupdf if it is missing. Measured on six of your own PDFs
         (623 pages): pypdf took 26.9 seconds, pymupdf took 2.4. Eleven times.
      3. Starts the server with every core in use.
      4. Waits for it, then brings the index up to date.

    Options:

        .\rebuild_index_fast.ps1 -Fast      switch to the smaller embedding
                                            model: ~2.7x quicker to index and
                                            to query, slightly weaker recall.
                                            This builds a SEPARATE index, so
                                            the current one is left intact.
        .\rebuild_index_fast.ps1 -NoOcr     skip scanned pages entirely
                                            (faster, but you lose them)
        .\rebuild_index_fast.ps1 -PruneOldIndexes
                                            also delete indexes belonging to
                                            embedding models you no longer use.
                                            Frees a lot of disk. Not reversible.
        .\rebuild_index_fast.ps1 -Force     rebuild from scratch even though an
                                            index already exists. Hours. Only
                                            for a corrupt index.

    If an index for this profile ALREADY exists, this script does NOT rebuild
    it -- it does an incremental pass instead, which picks up new PDFs in
    seconds. Rebuilding a finished index would cost hours and gain nothing.
#>

param(
    [switch]$Fast,
    [switch]$NoOcr,
    [switch]$PruneOldIndexes,
    [switch]$Force,
    [int]$WaitSeconds = 900
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$base = 'http://127.0.0.1:8001'

function Invoke-Native {
    <#
        Run an external program and return ONLY its exit code.

        PowerShell 5.1 turns any stderr output from a native command into a
        terminating error while $ErrorActionPreference is 'Stop' -- even when the
        command did exactly what was asked, and even with 2>$null in place. A
        failed "import pymupdf" printing a ModuleNotFoundError traceback was
        enough to kill this script at step 2.

        So: relax the preference for the call, throw the output away, and judge
        success by the exit code, which is the only reliable signal here.
    #>
    param(
        [Parameter(Mandatory)][string]$Command,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command @Arguments 2>&1 | Out-Null
        return $LASTEXITCODE
    } catch {
        return 1
    } finally {
        $ErrorActionPreference = $previous
    }
}

# ---------------------------------------------------------------- 1. stop ---
Write-Host ""
Write-Host "1. Stopping any RAG server that is already running" -ForegroundColor Cyan

$stopped = 0
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*main.py*' } |
    ForEach-Object {
        Write-Host "   stopping PID $($_.ProcessId)" -ForegroundColor DarkGray
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped++
    }
if ($stopped -eq 0) {
    Write-Host "   nothing was running." -ForegroundColor DarkGray
} else {
    Start-Sleep -Seconds 3
}

# ------------------------------------------------------------- 2. pymupdf ---
Write-Host ""
Write-Host "2. Checking the fast PDF reader" -ForegroundColor Cyan

# find_spec rather than a bare import: a missing module then costs an exit code
# instead of a traceback on stderr.
$probe = 'import importlib.util,sys;sys.exit(0 if importlib.util.find_spec(''pymupdf'') else 1)'

if ((Invoke-Native 'python' @('-c', $probe)) -eq 0) {
    Write-Host "   already installed." -ForegroundColor Green
} else {
    Write-Host "   installing pymupdf..." -ForegroundColor DarkGray
    if ((Invoke-Native 'python' @('-m', 'pip', 'install', '--quiet', 'pymupdf')) -eq 0) {
        Write-Host "   installed." -ForegroundColor Green
    } else {
        Write-Host "   install failed - indexing still works, just ~11x slower" -ForegroundColor Yellow
        Write-Host "   at reading PDFs. Carrying on." -ForegroundColor Yellow
    }
}

# -------------------------------------------------------------- 3. server ---
Write-Host ""
Write-Host "3. Starting the server" -ForegroundColor Cyan

$env:AZURE_OPENAI_ENDPOINT        = "https://aif-haca-shared-dev.services.ai.azure.com"
$env:AZURE_OPENAI_CHAT_DEPLOYMENT = "gpt-5.6-luna"

# Default matches main.py's own default, so running this script never silently
# switches model and rebuilds 24,000 chunks you already had.
if ($Fast) { $env:RAG_PROFILE = 'fast' } else { $env:RAG_PROFILE = 'quality' }
if ($NoOcr)   { $env:RAG_OCR = '0' }          else { $env:RAG_OCR = '1' }

# Use every core. Torch is conservative by default on Windows and embedding is
# entirely thread-bound, so this is free.
$env:RAG_THREADS = "$([Environment]::ProcessorCount)"

# Only on request. These are indexes for other embedding models: never
# searched, and the reason chroma.sqlite3 has grown past 600 MB -- but deleting
# one means rebuilding it from scratch if you switch back, so it is opt-in.
if ($PruneOldIndexes) { $env:RAG_PRUNE_COLLECTIONS = '1' }

Write-Host "   profile : $env:RAG_PROFILE"
Write-Host "   OCR     : $(if ($env:RAG_OCR -eq '0') { 'off' } else { 'on' })"
Write-Host "   threads : $env:RAG_THREADS"

$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("rag_rebuild_{0}.log" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))

$server = Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Minimized `
    -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        "Set-Location '$root'; $env:PYTHONUNBUFFERED=1; python -u main.py *>&1 | Tee-Object -FilePath '$log'"
    )

Write-Host "   started (PID $($server.Id)), log: $log" -ForegroundColor Green

# ---------------------------------------------------------------- 4. wait ---
Write-Host ""
Write-Host "4. Waiting for it to load the models" -ForegroundColor Cyan
Write-Host "   (the first run on a new profile downloads the model)" -ForegroundColor DarkGray

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$info = $null
while ((Get-Date) -lt $deadline) {
    try { $info = Invoke-RestMethod "$base/" -TimeoutSec 10; break }
    catch { Start-Sleep -Seconds 10; Write-Host "." -NoNewline }
}
Write-Host ""

if (-not $info) {
    Write-Host "   The server did not come up. Look at the log:" -ForegroundColor Red
    Write-Host "     Get-Content '$log' -Tail 40" -ForegroundColor Yellow
    exit 1
}

Write-Host "   up: $($info.pipeline_version), model $($info.embedding_model)" -ForegroundColor Green
Write-Host "   currently holds $($info.indexed_chunks) chunks" -ForegroundColor Green

# ------------------------------------------------------------- 5. reindex ---
# A FULL rebuild deletes the collection and re-embeds every chunk. On this
# corpus that is hours. So it only happens when there is genuinely nothing to
# reuse -- otherwise an incremental pass picks up whatever is new and leaves the
# finished work alone. This guard exists because the obvious version of this
# script would happily throw away a completed index.
$existing = [int]$info.indexed_chunks

if ($existing -gt 0 -and -not $Force) {
    Write-Host ""
    Write-Host "5. Index already holds $existing chunks - NOT rebuilding" -ForegroundColor Cyan
    Write-Host "   Doing an incremental pass instead (new/changed PDFs only)." -ForegroundColor DarkGray
    Write-Host "   To force a full rebuild anyway: .\rebuild_index_fast.ps1 -Force" -ForegroundColor DarkGray
    $url = "$base/reindex?incremental=true"
} else {
    Write-Host ""
    Write-Host "5. Building the index from scratch" -ForegroundColor Cyan
    Write-Host "   This is the slow one. Progress goes to the log - watch it" -ForegroundColor DarkGray
    Write-Host "   live in ANOTHER window with:" -ForegroundColor DarkGray
    Write-Host "     Get-Content '$log' -Wait -Tail 20" -ForegroundColor Yellow
    $url = "$base/reindex"
}
Write-Host ""

$started = Get-Date
try {
    $result = Invoke-RestMethod -Method Post $url -TimeoutSec 0
} catch {
    Write-Host "Reindex FAILED: $_" -ForegroundColor Red
    Write-Host "  Get-Content '$log' -Tail 40" -ForegroundColor Yellow
    exit 1
}

$elapsed = (Get-Date) - $started
Write-Host ""
Write-Host "Done in $([int]$elapsed.TotalMinutes) min $($elapsed.Seconds) s." -ForegroundColor Green
Write-Host "  $($result.indexed_chunks) chunks in the index." -ForegroundColor Green
Write-Host ""
Write-Host "The extracted text is now cached in .extract_cache, so if you ever" -ForegroundColor DarkGray
Write-Host "rebuild again the PDF reading and the OCR are already done." -ForegroundColor DarkGray
Write-Host ""
Write-Host "From here on the nightly HACA-RAG-Reindex task only touches new and" -ForegroundColor DarkGray
Write-Host "changed files, which takes seconds." -ForegroundColor DarkGray
Write-Host ""
exit 0
