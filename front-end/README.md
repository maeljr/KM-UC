# HACA Partners — Projet 45 · Knowledge Assistant

Assistant de connaissance interne basé sur un moteur RAG. Le backend interroge Azure AI Search, le frontend propose un chat conversationnel, la page RegWatch, le générateur de documents et les journaux d'audit.

---

## Table des matières

1. [Fonctionnalités](#fonctionnalités)
2. [Architecture](#architecture)
3. [Prérequis](#prérequis)
4. [Démarrage](#démarrage)
5. [Configuration](#configuration)
6. [Routes disponibles](#routes-disponibles)
7. [Déploiement](#déploiement)

---

## Fonctionnalités

- **Knowledge Assistant** : chat RAG sourcé via Azure AI Search.
- **RegWatch** : veille réglementaire sur des sources externes.
- **Génération de documents** : offres `.pptx` et lettres `.docx` à partir de bibliothèques validées.
- **Knowledge Repository** : consultation des documents indexés.
- **Audit Logs** : journalisation des actions utilisateur.
- **Mode conversationnel multi-tours** : historique persistant, follow-ups, réponses concises ou détaillées.
- **Persistance locale** : l'état du chat et les logs survivent au refresh.

---

## Architecture

| Composant | Technologie | Port local |
|-----------|-------------|------------|
| Frontend | React + TypeScript + Vite + TanStack Router | 8080 |
| Backend RAG | Python + FastAPI + ChromaDB + Azure AI Search | 8000 |
| Service de génération | Python + FastAPI + python-pptx / python-docx | 8001 |

Le frontend est le seul point d'entrée utilisateur. Le proxy Vite redirige `/api` vers le backend RAG et `/api/generation` vers le service de génération.

---

## Prérequis

- **Node.js** ≥ 20
- **Bun** (recommandé) ou npm/pnpm
- **Python** ≥ 3.11
- Accès aux ressources Azure : AI Search + Azure OpenAI

---

## Démarrage

### 1. Backend RAG

```powershell
cd C:\Dev\HACA\KM%20UC\rag-local
.\.venv\Scripts\activate
python main.py
```

### 2. Service de génération

```powershell
cd C:\Dev\HACA\generation-service
.\.venv\Scripts\activate
uvicorn moteur_offres.service:service --host 127.0.0.1 --port 8001
```

### 3. Frontend

```powershell
cd C:\Dev\HACA\KM%20UC\front-end
bun install
bun run dev
```

Ou tout lancer avec le script :

```powershell
cd C:\Dev\HACA\KM%20UC\front-end
.\start-all.ps1
```

---

## Configuration

### Backend RAG

Le backend charge automatiquement le fichier `.env` situé dans `rag-local/` :

```env
SEARCH_API_KEY=...
AZURE_AI_KEY=...
AZURE_AI_ENDPOINT=https://aif-haca-shared-dev.services.ai.azure.com
SEARCH_ENDPOINT=https://srch-haca-shared-dev.search.windows.net
SEARCH_INDEX=indexdocuments-chunks
```

### Frontend

Les variables sont définies dans `.env` (copier `.env.exemple`) :

```env
VITE_API_URL=http://127.0.0.1:8000
```

En développement, le proxy Vite gère les appels :

```ts
"/api":            -> backend RAG (8000)
"/api/generation": -> service de génération (8001)
```

---

## Routes disponibles

### Frontend

| Route | Page |
|-------|------|
| `/` | Dashboard — chat RAG |
| `/repository` | Knowledge Repository |
| `/regwatch` | Alertes RegWatch |
| `/generation` | Générateur de documents |
| `/audit` | Audit Logs |

### Backend RAG

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/` | GET | Santé |
| `/ask` | POST | Question au RAG local |
| `/ask-azure` | POST | Question au RAG Azure |
| `/repository` | POST | Documents dédupliqués |

### Service de génération

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/sante` | GET | Diagnostic |
| `/api/catalogue` | GET | Bibliothèques disponibles |
| `/api/offre` | POST | Générer une offre `.pptx` |
| `/api/lettre` | POST | Générer une lettre `.docx` |
| `/api/document/{nom}` | GET | Télécharger le document |

---

## Déploiement

Le déploiement cible **Azure Static Web Apps** pour le frontend et **Azure Container Apps** pour le backend RAG. Le service de génération sera servi par le backend ou déployé séparément.

En production, le frontend appelle `/api` en relatif :

```env
VITE_API_URL=
```

L'authentification Azure AD est gérée via `/.auth/me` par le hook `useUser`.

---

## Contributeurs

- Mael Razafimbelo — RAG, frontend, intégration
- Équipe HACA Partners — métier, bibliothèques documentaires, service de génération