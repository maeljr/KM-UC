# RAG Local – Projet 45 (HACA Knowledge Assistant)

Serveur RAG (Retrieval-Augmented Generation) local développé avec **FastAPI**, **ChromaDB** et **Ollama**. Il permet d'indexer des documents PDF réglementaires et de poser des questions en langage naturel. Les réponses sont sourcées et accompagnées d'un score de confiance.

> **Statut :** Version stable (16/07/2026). En attente de migration vers Azure AI Search + Claude Sonnet.

---

## Table des matières

1. [Démarrage rapide](#démarrage-rapide)
2. [Endpoints API](#endpoints-api)
3. [Architecture](#architecture)
4. [Stratégie de chunking](#stratégie-de-chunking)
5. [Sécurité et fiabilité](#sécurité-et-fiabilité)
6. [Tests et évaluation](#tests-et-évaluation)
7. [Limitations connues](#limitations-connues)
8. [Roadmap](#roadmap)

---

## Démarrage rapide

### Prérequis

- **Python 3.10+** avec `pip`
- **Ollama** ([ollama.com](https://ollama.com))
- **Bun** (optionnel, pour le front-end)

### Installation

```bash
# 1. Cloner le dépôt
git clone https://dev.azure.com/hacapartners/HACA-AI-KM/_git/HACA-AI-KM
cd "HACA-AI-KM/rag-local"

# 2. Créer l'environnement virtuel
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate   # Linux/Mac

# 3. Installer les dépendances
pip install -r requirements.txt

# 4. Installer le modèle Ollama
ollama pull llama3.2:3b   # Recommandé (léger, rapide)
# ollama pull mistral:7b   # Alternative (plus lent, plus précis)
```

### Lancer le serveur

```bash
python main.py
```

Le serveur écoute sur `http://localhost:8000`. Vous pouvez aussi utiliser le script `start.bat` à la racine du projet pour lancer le RAG et le front-end simultanément.

### Indexer des documents

Placez vos fichiers PDF dans le dossier `docs/`, puis :

```bash
curl -X POST http://localhost:8000/reindex
```

Ou utilisez Postman : `POST /reindex`.

---

## Endpoints API

| Méthode | URL | Description | Body |
|---------|-----|-------------|------|
| `GET` | `/` | Vérifier que le serveur tourne | - |
| `POST` | `/ask` | Poser une question | `{"query": "Votre question"}` |
| `POST` | `/reindex` | Réindexer tous les PDFs du dossier `docs/` | - |

### Exemple de réponse (`/ask`)

```json
{
  "answer": "La date limite est le 17 août 2026. [Source : CSSF_CPDI_2651.pdf]",
  "confidence": "moyenne",
  "confidence_score": 65,
  "best_distance": 0.669,
  "sources": [
    { "source": "CSSF_CPDI_2651.pdf", "chunk_index": 0 },
    { "source": "CSSF_CPDI_2651.pdf", "chunk_index": 1 }
  ]
}
```

### Niveaux de confiance

| Score | Niveau | Couleur | Signification |
|-------|--------|---------|---------------|
| 85-100 % | Élevée | 🟢 | Le meilleur chunk est très proche de la question |
| 50-85 % | Moyenne | 🟡 | Bonne correspondance, vérifier la source |
| 30-50 % | Faible | 🟠 | Correspondance approximative, prudence |
| 0-30 % | Très faible | 🔴 | À considérer avec réserve |

---

## Architecture

```
rag-local/
  main.py              ← Serveur API (FastAPI + ChromaDB + Ollama)
  requirements.txt     ← Dépendances Python
  start.bat            ← Script de démarrage rapide (appelle aussi le front-end)
  docs/                ← PDFs à indexer (non versionné)
  chroma_db/           ← Base vectorielle (générée automatiquement, non versionnée)
  chroma_db_test/      ← Base de test pour l'évaluation (non versionnée)
  chunking/            ← Différentes stratégies de découpage de texte
  eval/                ← Suite d'évaluation avec métriques
  README.md            ← Ce fichier
```

### Pipeline de traitement

1. **Extraction** : le texte est extrait des PDFs via `pypdf`.
2. **Chunking** : le texte est découpé en paragraphes cohérents (Paragraph Chunker).
3. **Embedding** : chaque chunk est vectorisé avec `all-MiniLM-L6-v2` (384 dimensions).
4. **Indexation** : les vecteurs sont stockés dans ChromaDB.
5. **Recherche** : à chaque question, ChromaDB retrouve les 5 chunks les plus proches.
6. **Génération** : les chunks sont envoyés à Ollama (Llama 3.2 3B) avec un prompt structuré.
7. **Sécurité** : filtrage documentaire, seuil de distance, règles anti-hallucination.

---

## Stratégie de chunking

Quatre méthodes ont été évaluées le 15-16 juillet 2026 :

| Méthode | Score de couverture des mots-clés | Precision@1 | Precision@5 | Statut |
|---------|----------------------------------|-------------|-------------|--------|
| **Paragraph Chunker** | **86,2 %** | 50,0 % | **62,5 %** | ✅ Utilisé |
| Baseline (mots) | 63,3 % | **75,0 %** | 50,0 % | ❌ Rejeté |
| Token-based (512 tokens) | 61,7 % | **75,0 %** | 37,5 % | ❌ Rejeté |
| Recursive (LangChain) | 36,2 % | 50,0 % | 25,0 % | ❌ Rejeté |

Le **Paragraph Chunker** a été retenu pour sa capacité à préserver la cohérence des idées et à maximiser la couverture des mots-clés.

Pour lancer une nouvelle campagne de tests :

```bash
python eval/evaluator.py
```

Les résultats sont sauvegardés dans `eval/runs/` (dossier horodaté).

---

## Sécurité et fiabilité

Le système intègre trois barrières de sécurité pour garantir des réponses fiables :

### 1. Filtrage documentaire
Un dictionnaire de mots-clés associe des thèmes à des documents spécifiques. Si la question mentionne un thème connu, la recherche est forcée dans le document correspondant. Cela évite les mélanges de sujets.

**Limite :** ce dictionnaire est manuel et ne couvre pas toutes les formulations. Il sera remplacé par les métadonnées automatiques dans Azure AI Search.

### 2. Seuil de distance
Si le meilleur chunk trouvé a une distance sémantique supérieure à 1.35, la réponse est bloquée et le système répond « Aucun document pertinent trouvé ». Cela empêche les réponses sur des sujets hors corpus.

### 3. Règles anti-hallucination
Le prompt contient 6 règles impératives qui contraignent le modèle à rester factuel, à citer ses sources, et à refuser d'inventer des informations absentes des documents.

---

## Tests et évaluation

### Tests classiques (11 questions)
Série de questions couvrant les dates, les obligations réglementaires, les exclusions, et les questions hors corpus.

**Score :** 7/11 succès, 1/11 partiel, 3/11 échecs (64 %).

### Tests de robustesse (8 questions inédites)
Série de questions avec des formulations nouvelles pour évaluer la capacité du système à généraliser.

**Score :** 3/8 succès, 5/8 échecs (37 %).

### Interprétation
Le système est fiable sur les questions proches des documents, mais peine à généraliser sur des formulations nouvelles. Ces limites sont inhérentes au petit modèle local (Llama 3.2 3B) et au dictionnaire de routage manuel. La migration vers Azure AI Search + Claude Sonnet devrait résoudre la majorité de ces problèmes.

---

## Limitations connues

| Limite | Cause | Solution prévue |
|--------|-------|-----------------|
| Échec sur les questions inédites | Dictionnaire de routage manuel | Azure AI Search (recherche hybride) |
| Confusion entre catégories (haut risque vs liste grise) | Petit modèle 3B | Claude Sonnet |
| Dates ou tableaux non extraits | Extraction via `pypdf` | Amélioration avec `pdfplumber` |
| Réponses trop prudentes | Modèle 3B trop littéral | Claude Sonnet |
| Pas de parallélisme | API synchrone | Azure Functions |

---

## Roadmap

| Étape | Description | Échéance |
|-------|-------------|----------|
| ✅ | RAG local stable | 16/07/2026 |
| 🔜 | Migration vers Azure AI Search | Dès réception des accès |
| 🔜 | Remplacement de Llama par Claude Sonnet | Dès réception des accès |
| 🔜 | Déploiement du front-end sur Azure Static Web Apps | Dès réception des accès |
| 📅 | Indexation de nouveaux documents | Phase 2 |
| 📅 | Suppression du dictionnaire de routage manuel | Phase 2 |

---

## Équipe

- **Mael Razafimbelo** – Développement du RAG local, évaluation, front-end
- **Équipe HACA** – Expertise métier, validation des réponses

Pour toute question, ouvrir une issue sur Azure DevOps ou contacter Mael directement.

---

*Document mis à jour le 16 juillet 2026.*