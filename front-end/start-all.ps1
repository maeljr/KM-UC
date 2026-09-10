# ========== Démarrage complet Projet 45 ==========

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEMARRAGE PROJET 45" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Backend RAG (port 8000)
Write-Host "`n[1/3] Démarrage du backend RAG (port 8000)..." -ForegroundColor Yellow
Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-Command", "cd 'C:\Dev\HACA\KM%20UC\rag-local'; .\.venv\Scripts\python.exe main.py"
)

# 2. Service de génération (port 8001)
Write-Host "[2/3] Démarrage du service de génération (port 8001)..." -ForegroundColor Yellow
Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-Command", "cd 'C:\Users\MaëlRazafimbelo\Downloads\generation\generation'; .\venv\Scripts\activate; uvicorn moteur_offres.service:service --host 127.0.0.1 --port 8001"
)

# 3. Frontend (port 8080)
Write-Host "[3/3] Démarrage du frontend (port 8080)..." -ForegroundColor Yellow
Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-Command", "cd 'C:\Dev\HACA\KM%20UC\front-end'; bun run dev"
)

Write-Host "`nTous les services sont lancés." -ForegroundColor Green
Write-Host "Frontend accessible sur http://localhost:8080" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan