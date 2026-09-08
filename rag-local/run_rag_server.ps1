<#
    run_rag_server.ps1 - start the HACA RAG API and keep a log.

    This is what the scheduled task runs at logon. Same job as run.ps1, but
    non-interactive: it never prompts, writes everything to a log file, and
    exits with a code so Task Scheduler shows a failure instead of pretending
    all is well.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("rag_server_{0}.log" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))

$env:AZURE_OPENAI_ENDPOINT        = "https://aif-haca-shared-dev.services.ai.azure.com"
$env:AZURE_OPENAI_CHAT_DEPLOYMENT = "gpt-5.6-luna"

# Speed settings. These must match whatever rebuild_index_fast.ps1 built the
# index with: the collection name carries the embedding model, so a mismatched
# profile here would silently open an EMPTY collection and every question would
# come back "not found in the documents provided".
if (-not $env:RAG_PROFILE) { $env:RAG_PROFILE = 'quality' }

# Use every core. Torch is conservative by default on Windows, and embedding is
# entirely thread-bound.
if (-not $env:RAG_THREADS) { $env:RAG_THREADS = "$([Environment]::ProcessorCount)" }

# The key comes from your Windows profile (setx, once). A scheduled task
# inherits it automatically - which is exactly why it lives there and not in
# a file.
# setx writes the key to your Windows profile (HKCU\Environment), but any
# process that was ALREADY running keeps the environment block it started with.
# Task Scheduler is one of those processes, so a key set five minutes ago stays
# invisible to a task until the next logon. Reading the stored value directly
# avoids making anyone log out to pick up their own setting.
if (-not $env:AZURE_OPENAI_API_KEY) {
    $stored = [Environment]::GetEnvironmentVariable('AZURE_OPENAI_API_KEY', 'User')
    if (-not $stored) {
        $stored = [Environment]::GetEnvironmentVariable('AZURE_OPENAI_API_KEY', 'Machine')
    }
    if ($stored) { $env:AZURE_OPENAI_API_KEY = $stored }
}

# A missing key is NOT a reason to refuse to start. Only answer generation
# needs Azure -- the index, the search and every diagnostic are local. Exiting
# here meant one unset variable took the whole service down and left no way to
# see whether the index was even built. Warn, and let it come up.
if (-not $env:AZURE_OPENAI_API_KEY -and $env:RAG_AZURE_AUTH -ne 'identity') {
    "WARNING: no AZURE_OPENAI_API_KEY found, in this shell or your profile." |
        Tee-Object -FilePath $log
    "Search and indexing will work; ANSWERS will not. To fix, run once:" |
        Tee-Object -FilePath $log -Append
    '    setx AZURE_OPENAI_API_KEY "your-key"' | Tee-Object -FilePath $log -Append
    "then open a NEW terminal (setx only affects shells started afterwards)." |
        Tee-Object -FilePath $log -Append
}

# Is one already running? This task fires at logon and can also be started by
# hand, so a second instance is easy to ask for by accident. Uvicorn's reply to
# that is a WinError 10048 traceback, which reads like a crash rather than
# "there is already a healthy server here". Check first and say so plainly.
try {
    $alive = Invoke-RestMethod 'http://127.0.0.1:8001/' -TimeoutSec 5
} catch {
    $alive = $null
}
if ($alive) {
    "A RAG server is ALREADY running on port 8001 - nothing to do." |
        Tee-Object -FilePath $log
    "  version : $($alive.pipeline_version)" | Tee-Object -FilePath $log -Append
    "  chunks  : $($alive.indexed_chunks)"   | Tee-Object -FilePath $log -Append
    "  answers : $($alive.answers_enabled)"  | Tee-Object -FilePath $log -Append
    'To replace it, stop it first - see check_rag.ps1 or the README.' |
        Tee-Object -FilePath $log -Append
    exit 0
}

"=== RAG server starting $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" |
    Tee-Object -FilePath $log

Get-ChildItem $logDir -Filter 'rag_server_*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force -ErrorAction SilentlyContinue

# Pick a python that can actually IMPORT the dependencies -- not merely the
# first python.exe that exists.
#
# A bare project .venv is worse than useless here: it resolves, then dies on the
# first import. And because Python's logging writes to STDERR, that failure was
# invisible: with $ErrorActionPreference = 'Stop', ANY stderr from a native
# command is a terminating error, so the script died before the pipeline flushed
# a single line to the log. The log ended at "python: ..." with no explanation.
$REQUIRED = 'chromadb', 'sentence_transformers', 'fastapi', 'uvicorn'

function Test-Python {
    param([string]$Exe)
    if (-not $Exe) { return $false }
    $probe = 'import importlib.util as u,sys;' +
             'sys.exit(0 if all(u.find_spec(m) for m in (' +
             "'chromadb','sentence_transformers','fastapi','uvicorn'" +
             ')) else 1)'
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe -c $probe 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previous
    }
}

$candidates = @()
$candidates += (Join-Path $root '.venv\Scripts\python.exe')
$candidates += (Join-Path (Split-Path -Parent $root) '.venv\Scripts\python.exe')
$found = Get-Command python.exe -ErrorAction SilentlyContinue
if ($found) { $candidates += @($found | ForEach-Object { $_.Source }) }
foreach ($scope in @('User', 'Machine')) {
    $raw = [Environment]::GetEnvironmentVariable('PATH', $scope)
    if (-not $raw) { continue }
    foreach ($dir in $raw.Split(';')) {
        if ($dir) { $candidates += ($dir.TrimEnd('\') + '\python.exe') }
    }
}

$python = $null
$rejected = @()
foreach ($candidate in $candidates) {
    if (-not (Test-Path $candidate -ErrorAction SilentlyContinue)) { continue }
    if (Test-Python $candidate) { $python = $candidate; break }
    if ($rejected -notcontains $candidate) { $rejected += $candidate }
}

foreach ($bad in $rejected) {
    "skipped (missing packages): $bad" | Tee-Object -FilePath $log -Append
}

if (-not $python) {
    'ERROR: no python found with the required packages installed.' |
        Tee-Object -FilePath $log -Append
    "Needed: $($REQUIRED -join ', ')" | Tee-Object -FilePath $log -Append
    'Install them into the python you use, then start this again:' |
        Tee-Object -FilePath $log -Append
    '    python -m pip install -r requirements.txt' |
        Tee-Object -FilePath $log -Append
    exit 1
}

"python: $python" | Tee-Object -FilePath $log -Append

# -u is not optional: piping Python's output makes it BLOCK-buffered, so a
# server loading models or indexing writes nothing for minutes and looks hung.
$env:PYTHONUNBUFFERED = '1'

# And 'Continue' is not optional either. Python logs to stderr by design, so
# under 'Stop' the server's own first INFO line would terminate this script.
$ErrorActionPreference = 'Continue'

# ForEach-Object { "$_" } flattens each line to a plain string BEFORE it reaches
# the log. Without it, every ordinary Python log line arriving on stderr is
# wrapped as a PowerShell ErrorRecord and written out with five lines of
# "NativeCommandError / At run_rag_server.ps1:164 char:1 / + & $python ..."
# decoration around it. That turns a readable startup log into a wall of fake
# errors, which is exactly what made a working server look broken.
& $python -u main.py 2>&1 | ForEach-Object { "$_" } |
    Tee-Object -FilePath $log -Append

exit $LASTEXITCODE
