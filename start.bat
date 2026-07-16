@echo off
echo ============================================
echo  Projet 45 - HACA Knowledge Assistant
echo ============================================
echo.
echo [1/2] Demarrage du serveur RAG local...
start "RAG Local" cmd /k "cd rag-local && .venv\Scripts\activate && python main.py"
echo.
echo [2/2] Demarrage du front-end...
start "Front-end" cmd /k "cd front-end && bun run dev"
echo.
echo Les deux serveurs sont en cours de demarrage.
echo - RAG Local : http://localhost:8000
echo - Front-end : http://localhost:5173
echo.
echo Fermez les fenetres pour arreter les serveurs.
pause