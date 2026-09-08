<#
    register_rag_tasks.ps1 - make the RAG run itself.

    Two scheduled tasks, under YOUR account, no admin needed:

      HACA-RAG-Server    starts the API at logon AND checks hourly that it is
                         still up, so a crash cannot leave it down all day.
      HACA-RAG-Reindex   picks up new or changed PDFs every night.

    Usage:
        .\register_rag_tasks.ps1
        .\register_rag_tasks.ps1 -ReindexAt "22:00"
        .\register_rag_tasks.ps1 -ServerCheckFrom "06:00"
        .\register_rag_tasks.ps1 -Remove
#>

param(
    [string]$ReindexAt = '05:30',
    [string]$ServerCheckFrom = '07:00',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$serverTask  = 'HACA-RAG-Server'
$reindexTask = 'HACA-RAG-Reindex'

if ($Remove) {
    foreach ($name in @($serverTask, $reindexTask)) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed $name" -ForegroundColor Yellow
        }
    }
    return
}

function New-PsAction($script) {
    $path = Join-Path $root $script
    if (-not (Test-Path $path)) { throw "Missing $path" }
    New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"{0}`"" -f $path) `
        -WorkingDirectory $root
}

# ---------------- the API server ----------------
# ExecutionTimeLimit MUST be zero. This task is a long-running service, and the
# default limit would have Task Scheduler kill it after three days - which
# would look exactly like "the RAG randomly stopped working".
$serverSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 2)

# TWO triggers, and the second one is the important one.
#
# With only an at-logon trigger the server started once, and if it ever died -
# a crash, a killed process, a sleep it did not survive - nothing brought it
# back until the next logon. That happened, and for two days it looked like
# "the RAG randomly stopped working".
#
# So: at logon, AND an hourly check from $ServerCheckFrom. MultipleInstances
# IgnoreNew makes the hourly check a no-op while it is already running, so it
# costs nothing when all is well and fixes it when it is not.
#
# This used to live in a separate fix_server_trigger.ps1 applied by hand after
# the fact. A one-off patch script is a fix a fresh machine never gets, so it
# belongs here instead - and that patch script is now deleted.
$serverLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$serverLogon.Delay = 'PT1M'

$serverDaily  = New-ScheduledTaskTrigger -Daily -At $ServerCheckFrom
$serverRepeat = New-ScheduledTaskTrigger -Once -At $ServerCheckFrom `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 23)
$serverDaily.Repetition = $serverRepeat.Repetition

if (Get-ScheduledTask -TaskName $serverTask -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $serverTask -Confirm:$false
}
Register-ScheduledTask `
    -TaskName    $serverTask `
    -Description 'HACA RAG API (Projet 45) - starts at logon, checked hourly so a crash cannot leave it down all day.' `
    -Action      (New-PsAction 'run_rag_server.ps1') `
    -Trigger     @($serverLogon, $serverDaily) `
    -Settings    $serverSettings | Out-Null

# ---------------- the nightly reindex ----------------
$reindexLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$reindexLogon.Delay = 'PT10M'

$reindexSettings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6)

if (Get-ScheduledTask -TaskName $reindexTask -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $reindexTask -Confirm:$false
}
Register-ScheduledTask `
    -TaskName    $reindexTask `
    -Description 'HACA RAG nightly incremental reindex - picks up new or changed PDFs in the docs folder.' `
    -Action      (New-PsAction 'reindex_rag.ps1') `
    -Trigger     @(
        # 05:30 is when the laptop is asleep, so the daily trigger on its own
        # fired once in the whole project. The logon trigger is what actually
        # makes this happen - the same pattern RegWatch uses. 10 minutes so it
        # does not race HACA-RAG-Server loading its models.
        (New-ScheduledTaskTrigger -Daily -At $ReindexAt),
        $reindexLogon
    ) `
    -Settings    $reindexSettings | Out-Null

Write-Host ""
Write-Host "Scheduled:" -ForegroundColor Green
Write-Host "  $serverTask   - 1 min after logon, then checked hourly from $ServerCheckFrom"
Write-Host "  $reindexTask  - nightly at $ReindexAt, new/changed PDFs only"
Write-Host ""
Write-Host "  logs: $(Join-Path $root 'logs')"
Write-Host ""
Write-Host "Start the server now instead of waiting for the next logon:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName $serverTask"
Write-Host ""
Write-Host "Note: the RAG holds about 1.5 GB of models in memory while running." -ForegroundColor DarkGray
Write-Host "That is the price of answering instantly at any time." -ForegroundColor DarkGray
