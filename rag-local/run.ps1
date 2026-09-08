<#
    run.ps1 - start the HACA RAG API.

    The API key is NO LONGER stored in this file. It used to be, and that key
    has since travelled through chat attachments and a Git working tree, so it
    should be treated as compromised and rotated in Azure.

    Set it once, in a normal PowerShell window:

        setx AZURE_OPENAI_API_KEY "your-new-key"

    then close that window and open a new one (setx only affects NEW shells).
    After that, this script just starts the server.
#>

$ErrorActionPreference = 'Stop'

# Non-secret settings can live here.
$env:AZURE_OPENAI_ENDPOINT        = "https://aif-haca-shared-dev.services.ai.azure.com"
$env:AZURE_OPENAI_CHAT_DEPLOYMENT = "gpt-5.6-luna"

# Must match the profile the index was BUILT with - the collection name carries
# the embedding model, so a mismatch opens an empty collection instead of
# failing loudly, and every question answers "not found in the documents".
if (-not $env:RAG_PROFILE) { $env:RAG_PROFILE = 'quality' }
if (-not $env:RAG_THREADS) { $env:RAG_THREADS = "$([Environment]::ProcessorCount)" }

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

# Two ways to authenticate. On Azure there is NO key: the App Service uses a
# managed identity and RAG_AZURE_AUTH=identity is set as an App Setting.
# On a laptop the key is set ONCE with setx and lives in your Windows profile
# from then on - you never type it again.
if ($env:RAG_AZURE_AUTH -eq 'identity') {
    Write-Host "Auth       : managed identity (no key needed)" -ForegroundColor Green
}
elseif (-not $env:AZURE_OPENAI_API_KEY) {
    Write-Host ""
    Write-Host "AZURE_OPENAI_API_KEY is not set." -ForegroundColor Red
    Write-Host ""
    Write-Host "Set it ONCE - it is then stored in your Windows profile and" -ForegroundColor Yellow
    Write-Host "you will never have to type it again:" -ForegroundColor Yellow
    Write-Host '    setx AZURE_OPENAI_API_KEY "your-key"' -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Then CLOSE this window, open a new one (setx only affects" -ForegroundColor Yellow
    Write-Host "shells opened afterwards), and run .\run.ps1 again." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
else {
    Write-Host "Auth       : API key from your Windows profile" -ForegroundColor Green
}

Write-Host "Endpoint   : $env:AZURE_OPENAI_ENDPOINT"
Write-Host "Deployment : $env:AZURE_OPENAI_CHAT_DEPLOYMENT"
Write-Host "Starting server on http://127.0.0.1:8001 ..."
Write-Host ""
Write-Host "Profile    : $env:RAG_PROFILE  (threads: $env:RAG_THREADS)" -ForegroundColor DarkGray
Write-Host "If the collection is empty, build it with .\rebuild_index_fast.ps1" -ForegroundColor DarkGray
Write-Host ""

python main.py
