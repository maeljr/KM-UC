<#
    check_rag.ps1 - is the RAG working, and if not, exactly which part is broken.

        cd C:\chunk\rag-local
        .\check_rag.ps1
        .\check_rag.ps1 -Restart      restart the server first
        .\check_rag.ps1 -Question "your question here"

    Checks in order, stopping at the first real failure, because each step only
    makes sense if the previous one passed:

        1. is anything listening on 8001
        2. what does the service say about itself
        3. does retrieval find anything (no Azure needed)
        4. does a full answer come back
#>

param(
    [switch]$Restart,
    [string]$Question = 'Quelles sont les obligations de la circulaire CSSF 24/856 ?',
    # Loading the embedding model and the reranker, plus HuggingFace's
    # revision checks, takes about 90 seconds from cold. 90 was exactly on the
    # boundary and reported a healthy server as down.
    [int]$WaitSeconds = 240
)

$base = 'http://127.0.0.1:8001'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Half of the accent problem is the console itself: PowerShell 5.1 writes to a
# Windows-1252 console by default, so an accented character is printed as two
# mojibake characters even when the string in memory is correct. Left set for
# the rest of the window's life, which is what you want when you are reading
# French answers; the script has several exit points and unwinding it at each
# one would be more code than the setting is worth.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Show($label, $value, $ok) {
    $colour = if ($ok -eq $true) { 'Green' } elseif ($ok -eq $false) { 'Red' } else { 'Gray' }
    Write-Host ("  {0,-22} {1}" -f $label, $value) -ForegroundColor $colour
}

if ($Restart) {
    Write-Host ""
    Write-Host "Restarting the server..." -ForegroundColor Cyan

    # Stop-ScheduledTask alone is NOT enough. It terminates the task's
    # PowerShell wrapper but leaves the python grandchild orphaned, still
    # running and still holding port 8001. The next check then connects to the
    # OLD server instantly, reports everything as up, and silently tests stale
    # code -- which is exactly how an api-version fix appeared to do nothing.
    Stop-ScheduledTask -TaskName HACA-RAG-Server -ErrorAction SilentlyContinue

    $killed = 0
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*main.py*' } |
        ForEach-Object {
            Write-Host "  stopping python PID $($_.ProcessId)" -ForegroundColor DarkGray
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            $killed++
        }
    if ($killed -eq 0) { Write-Host "  nothing was running" -ForegroundColor DarkGray }

    # Wait for the port to actually free up, so the new server can bind it.
    $freeBy = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $freeBy) {
        try {
            Invoke-RestMethod 'http://127.0.0.1:8001/' -TimeoutSec 3 | Out-Null
            Start-Sleep -Seconds 2
        } catch {
            break
        }
    }

    try {
        Invoke-RestMethod 'http://127.0.0.1:8001/' -TimeoutSec 3 | Out-Null
        Write-Host "  WARNING: something is STILL answering on 8001." -ForegroundColor Red
        Write-Host "  The checks below may be testing the old code." -ForegroundColor Red
    } catch {
        Write-Host "  port 8001 is free" -ForegroundColor DarkGray
    }

    Start-ScheduledTask -TaskName HACA-RAG-Server
    Write-Host "  waiting for it to load the models" -ForegroundColor DarkGray -NoNewline
}

# ------------------------------------------------------------------ 1. up ---
Write-Host ""
Write-Host "1. Is the server up?" -ForegroundColor Cyan

$deadline = (Get-Date).AddSeconds($(if ($Restart) { $WaitSeconds } else { 5 }))
$info = $null
while ((Get-Date) -lt $deadline) {
    try { $info = Invoke-RestMethod "$base/" -TimeoutSec 10; break }
    catch { Start-Sleep -Seconds 5; Write-Host "." -NoNewline }
}
Write-Host ""

if (-not $info) {
    Show 'listening on 8001' 'NO' $false
    Write-Host ""
    Write-Host "  Nothing is answering. The newest log:" -ForegroundColor Yellow
    $newest = Get-ChildItem (Join-Path $root 'logs') -Filter 'rag_server_*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest) {
        Write-Host "    $($newest.FullName)" -ForegroundColor DarkGray
        Write-Host ""
        Get-Content $newest.FullName -Tail 25 | ForEach-Object { Write-Host "    $_" }
    } else {
        Write-Host "    no log at all - the task never ran." -ForegroundColor Red
        Write-Host "    Try:  Start-ScheduledTask -TaskName HACA-RAG-Server" -ForegroundColor Yellow
    }
    exit 1
}

Show 'listening on 8001' 'yes' $true

# --------------------------------------------------------------- 2. state ---
Write-Host ""
Write-Host "2. What does it say about itself?" -ForegroundColor Cyan

$version = "$($info.pipeline_version)"
$chunks  = [int]$info.indexed_chunks
$answers = [bool]$info.answers_enabled

Show 'version' $version ($version -like 'v14*')
Show 'profile' "$($info.profile)" $null
Show 'embedding model' "$($info.embedding_model)" $null
Show 'collection' "$($info.collection)" $null
Show 'chunks indexed' $chunks ($chunks -gt 0)
Show 'hybrid search' "$($info.hybrid_search)" ([bool]$info.hybrid_search)
Show 'auth mode' "$($info.auth_mode)" $answers
Show 'answers enabled' $answers $answers

if ($version -notlike 'v14*') {
    Write-Host ""
    Write-Host "  This is OLD code still in memory. Restart it:" -ForegroundColor Yellow
    Write-Host "    .\check_rag.ps1 -Restart" -ForegroundColor Yellow
    exit 1
}

if ($chunks -eq 0) {
    Write-Host ""
    Write-Host "  The index is empty for this profile, so nothing can be found." -ForegroundColor Yellow
    Write-Host "  If another profile's index holds the chunks, start with THAT" -ForegroundColor Yellow
    Write-Host "  profile rather than rebuilding - see the log for which one." -ForegroundColor Yellow
    exit 1
}

if (-not $answers) {
    Write-Host ""
    Write-Host "  Retrieval works but answering is off:" -ForegroundColor Yellow
    Write-Host "    $($info.auth_problem)" -ForegroundColor Yellow
}

# ----------------------------------------------------------- 3. retrieval ---
# Deliberately before the answer test: this needs no Azure, so if it passes and
# the answer fails, the fault is the credential or the LLM, not the index.
Write-Host ""
Write-Host "3. Does retrieval find anything?" -ForegroundColor Cyan

try {
    $encoded = [uri]::EscapeDataString($Question)
    $search = Invoke-RestMethod "$base/debug/search?q=$encoded" -TimeoutSec 120
    $dense  = @($search.dense_hits)
    $bm25   = @($search.bm25_hits)
    $ranked = @($search.reranked)

    Show 'dense (vector) hits' $dense.Count ($dense.Count -gt 0)
    Show 'bm25 (exact) hits' $bm25.Count $null
    Show 'after reranking' $ranked.Count ($ranked.Count -gt 0)
    Show 'threshold' "$($search.threshold)" $null

    if ($ranked.Count -gt 0) {
        Write-Host "  best matches:" -ForegroundColor DarkGray
        $ranked | Select-Object -First 3 | ForEach-Object {
            $name = "$($_.source)"
            if ($name.Length -gt 52) { $name = $name.Substring(0, 52) }
            Write-Host ("    {0,8}  {1} {2}" -f $_.score, $name, $_.pages) -ForegroundColor DarkGray
        }
        if ([double]$ranked[0].score -lt [double]$search.threshold) {
            Write-Host "  Best score is BELOW the threshold, so /ask will" -ForegroundColor Yellow
            Write-Host "  correctly report that it found nothing." -ForegroundColor Yellow
        }
    }
} catch {
    Show 'retrieval' "FAILED: $($_.Exception.Message)" $false
    exit 1
}

if (-not $answers) {
    Write-Host ""
    Write-Host "The index and the search are fine. Only the Azure credential is" -ForegroundColor Yellow
    Write-Host "missing, so answers stay off until it is set." -ForegroundColor Yellow
    exit 0
}

# -------------------------------------------------------------- 4. answer ---
Write-Host ""
Write-Host "4. Does a full answer come back?" -ForegroundColor Cyan
Write-Host "  asking: $Question" -ForegroundColor DarkGray

$payload = @{ query = $Question; force_refresh = $true } | ConvertTo-Json
try {
    # UTF-8 explicitly: PowerShell 5.1 otherwise sends a string body as
    # ISO-8859-1, which mangles every accent in a French question before the
    # server ever sees it.
    $bytes    = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $response = Invoke-WebRequest -Method Post "$base/ask" -Body $bytes `
        -ContentType 'application/json; charset=utf-8' -TimeoutSec 300 `
        -UseBasicParsing

    # The other half of the same problem. The server answers UTF-8 but does
    # not put charset in its Content-Type, and PowerShell 5.1 then decodes the
    # body as ISO-8859-1 -- so "operant" comes back as "opArant" and a
    # perfectly good French answer looks corrupted. Decode the raw bytes
    # ourselves; fall back to the old path if the stream is not available.
    try {
        $answer = [System.Text.Encoding]::UTF8.GetString(
            $response.RawContentStream.ToArray()) | ConvertFrom-Json
    } catch {
        $answer = $response.Content | ConvertFrom-Json
    }
} catch {
    Write-Host ""
    Show 'ask' "FAILED" $false
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red

    # Getting the BODY out of a failed Invoke-RestMethod in PowerShell 5.1 is
    # fiddly: by the time the exception surfaces the response stream is often
    # already consumed, so reading it returns nothing. $_.ErrorDetails.Message
    # holds the body PowerShell already read, and is the reliable source.
    $detail = $null
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $detail = $_.ErrorDetails.Message
    }
    if (-not $detail) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream.CanSeek) { $stream.Position = 0 }
            $detail = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
        } catch { }
    }

    if ($detail) {
        try   { $detail = ($detail | ConvertFrom-Json).detail }
        catch { }
        Write-Host ""
        Write-Host "  the server said:" -ForegroundColor Red
        ($detail -split "`n") | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  (no body returned)" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "  Retrieval passed, so the index is fine - this is the Azure call." -ForegroundColor Yellow

    # A 404 has exactly three causes and they are indistinguishable from the
    # error text, so probe rather than hand back a puzzle.
    if ("$detail" -match '404') {
        Write-Host ""
        Write-Host "5. A 404 means the URL is wrong, not the key." -ForegroundColor Cyan
        Write-Host "   Trying every endpoint and api-version combination..." -ForegroundColor DarkGray
        Write-Host ""
        try {
            $probe = Invoke-RestMethod "$base/debug/azure/probe" -TimeoutSec 300
        } catch {
            Write-Host "   the probe itself failed: $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }

        Show 'deployment tested' "$($probe.deployment_tested)" $null
        foreach ($attempt in @($probe.attempts)) {
            $host_short = "$($attempt.endpoint)" -replace 'https://', ''
            $ok = ("$($attempt.result)" -eq 'OK')
            $colour = if ($ok) { 'Green' } else { 'DarkGray' }
            Write-Host ("    {0,-46} {1,-22} {2}" -f $host_short,
                        $attempt.api_version, $attempt.result) -ForegroundColor $colour
        }

        Write-Host ""
        if ($probe.working) {
            Write-Host "  FOUND A WORKING COMBINATION" -ForegroundColor Green
            Write-Host "    endpoint    : $($probe.working.endpoint)" -ForegroundColor Green
            Write-Host "    api version : $($probe.working.api_version)" -ForegroundColor Green
            Write-Host ""
            Write-Host "  Make it permanent, then restart:" -ForegroundColor Cyan
            Write-Host "    setx AZURE_OPENAI_ENDPOINT `"$($probe.working.endpoint)`"" -ForegroundColor Yellow
            Write-Host "    setx AZURE_OPENAI_API_VERSION `"$($probe.working.api_version)`"" -ForegroundColor Yellow
        } else {
            Write-Host "  NOTHING WORKED, so the DEPLOYMENT NAME is the problem." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Open Azure AI Foundry -> your resource -> Deployments." -ForegroundColor Yellow
            Write-Host "  That page shows the exact deployment name, the target" -ForegroundColor Yellow
            Write-Host "  URI, and a sample request with the right api-version." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Test a name without restarting anything:" -ForegroundColor Cyan
            Write-Host "    Invoke-RestMethod `"$base/debug/azure/probe?deployment=NAME`"" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Then set it for good:" -ForegroundColor Cyan
            Write-Host "    setx AZURE_OPENAI_CHAT_DEPLOYMENT `"NAME`"" -ForegroundColor Yellow
        }
    }
    exit 1
}

Write-Host ""
if (-not $answer -or -not $answer.answer) {
    Show 'answer' 'EMPTY - the server returned nothing usable' $false
    Write-Host "  raw response:" -ForegroundColor Yellow
    Write-Host "    $($answer | ConvertTo-Json -Depth 4)" -ForegroundColor DarkGray
    exit 1
}

Show 'language detected' "$($answer.detected_language)" $null
Show 'confidence' "$($answer.confidence)" $null
Show 'sources cited' "$(@($answer.sources).Count)" (@($answer.sources).Count -gt 0)
Write-Host ""
Write-Host "  ANSWER" -ForegroundColor Green
Write-Host ""
($answer.answer -split "`n") | ForEach-Object { Write-Host "    $_" }
Write-Host ""
if (@($answer.sources).Count -gt 0) {
    Write-Host "  SOURCES" -ForegroundColor Green
    @($answer.sources) | ForEach-Object {
        Write-Host "    - $($_.source) $($_.pages)" -ForegroundColor DarkGray
    }
    Write-Host ""
}
Write-Host "Everything works." -ForegroundColor Green
Write-Host ""
exit 0
