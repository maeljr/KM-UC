# Documentation du Projet 45  
## Base de connaissance intelligente — HACA Partners  
Période couverte : 16 juin 2026 – 30 juillet 2026  

---

## Phase 0 — Cadrage et conception (16 juin – 24 juin 2026)

### Objectif  
Définir le périmètre, les besoins métier et l'architecture cible avant tout développement.

### Actions réalisées  
- Onboarding et présentation de l'entreprise, de l'ERP et des différents use cases.  
- Constitution des équipes projet et identification des experts métier.  
- Analyse de la structure SharePoint existante : référentiels documentaires, types de documents, organisation des dossiers.  
- Définition des principes d'architecture : découplage moteur/interface, stratégie de sécurité.  
- Arbitrage technique des composants du pipeline RAG : moteur de recherche, LLM, embedding, orchestration, chunking.  
- Élaboration de la roadmap sur 3 mois (phases 0 à 5).  
- Réalisation des premières maquettes et du support de présentation.  

### Décisions clés  
- Pipeline RAG modulaire : extraction PDF, chunking, embedding, base vectorielle, génération.  
- Front-end Lovable connecté à un backend FastAPI.  
- Power Automate pressenti pour l'acheminement automatique des documents.

### Impact  
- Périmètre validé avec les parties prenantes le 24 juin.  
- Base de travail claire pour la phase de développement.

---

## Phase 1 — Premiers développements et workflows (25 juin – 8 juillet 2026)

### Objectif  
Mettre en place les fondations techniques : ingestion, interface, premiers flux automatisés.

### Actions réalisées  
- Développement des premiers workflows Power Automate pour le traitement des documents.  
- Documentation du processus d'implémentation (captures d'écran, étapes).  
- Amélioration de l'interface front-end Lovable.  
- Travail sur l'architecture d'intégration : Azure Static Web Apps, Azure Document Intelligence.  
- Refactorisation du front-end en SPA pour assurer la compatibilité Azure Static Web Apps.  
- Intégration du module de chat avec historique de conversation.  
- Configuration de l'environnement de développement, synchronisation Git Azure DevOps, résolution des conflits de branches.  
- Conception de l'agent de pertinence RegWatch : 40 mots-clés, 8 clusters, règles de décision.  
- Présentation aux experts métier le 8 juillet.  

### Décisions clés  
- Azure Static Web Apps pour l'hébergement front-end.  
- Azure Document Intelligence pour l'extraction de documents.  
- Power Automate pour l'ingestion automatique.  
- Agent RegWatch basé sur des mots-clés et clusters plutôt que sur une IA non maîtrisée.

### Impact  
- Première version du front-end présentée et validée par les experts.  
- Base technique pour l'ingestion documentaire posée.  
- Début du développement du module RegWatch.

### Points de blocage  
- Attente de l'infrastructure Azure complète (accès, ressources, déploiements).  

---

## Phase 2 — RAG local et évaluation (8 juillet – 16 juillet 2026)

### Objectif  
Construire un premier RAG fonctionnel en local, indépendant des services Azure encore indisponibles.

### Actions réalisées  
- Mise en place du RAG local : FastAPI, ChromaDB, Ollama avec Llama 3.2 3B.  
- Création de l'API REST : endpoints `/ask`, `/reindex`.  
- Installation et configuration d'Ollama en local.  
- Premiers tests d'indexation de PDFs réglementaires CSSF.  
- Regroupement par source majoritaire, filtrage par métadonnées, seuil de distance.  
- Ajustement du prompt : anti-hallucination, température à 0.0.  
- Tests de fiabilité sur 11 scénarios.  
- Correction du CORS et connexion du front-end Lovable au RAG local.  
- Implémentation d'une suite d'évaluation des chunkers (`evaluator.py`).  
- Comparaison des stratégies de chunking : baseline, paragraph, recursive, token-based.  
- Validation du Paragraph Chunker avec 86,2 % de couverture des mots-clés.  
- Intégration du score de confiance dans l'API.  

### Décisions clés  
- Découpage par paragraphes (Paragraph Chunker) retenu pour les documents longs.  
- Seuil de distance ajusté à 1.35 pour limiter les réponses hors périmètre.  
- Ollama en local pour éviter toute dépendance Azure pendant cette phase.  

### Impact  
- Premier système RAG fonctionnel de bout en bout (interface → API → réponse).  
- Base d'évaluation objective pour les chunkers.  
- Compatibilité front-end/backend établie.

---

## Phase 3 — Intégration Azure et montée en puissance du backend (17 juillet – 28 juillet 2026)

### Objectif  
Remplacer les composants locaux par des services Azure et industrialiser le pipeline.

### Actions réalisées  
- Sélection des LLM Azure : GPT-5.6-Luna pour la génération, GPT-5-mini pour la vérification.  
- Réception et configuration des accès Azure AI Foundry.  
- Intégration de GPT-5.6-Luna en remplacement de Llama 3.2.  
- Correction des erreurs d'API : `max_tokens` → `max_completion_tokens`, suppression de `temperature`.  
- Mise en place de l'authentification Device Code.  
- Implémentation de la vérification asynchrone (Dual LLM) avec threading.  
- Tests de performance : 11/11 succès contre 7/11 avec le modèle local, temps de réponse réduit de 4 à 10 fois.  
- Migration embedding Azure : remplacement de `all-MiniLM-L6-v2` (384d) par `embed-multilingual-v3` (1024d).  
- Élargissement du corpus documentaire à 17 PDFs réglementaires (DORA, ESG, ICT risk, CSSF).  
- Création du script `fetch_docs.py` pour le téléchargement automatique de documents.  
- Automatisation de l'extraction des métadonnées via GPT-5-mini.  
- Création de l'endpoint `/index` pour l'indexation incrémentale.  
- Tentative de migration Azure AI Search : création de l'index, indexation, débogage (non finalisé, volontairement désactivé).  
- Retrait des clés API du code source et nettoyage de l'historique Git.  

### Décisions clés  
- Abandon d'Azure CLI au profit du Device Code pour l'authentification.  
- Azure AI Search mis en veille : la recherche vectorielle instable a été désactivée (`USE_AZURE_SEARCH = False`).  
- Conservation de ChromaDB en local pour la phase MVP.  

### Impact  
- Le backend est plus performant, plus rapide et conforme aux exigences Azure.  
- Le corpus passe à 17 documents réglementaires couvrant les principaux domaines métier.  
- Les tests experts E1-E8 passent à 8/8 le 27 juillet.  

### Points de blocage  
- Azure AI Search non retenu pour le MVP en raison de l'instabilité de la recherche vectorielle.  

---

## Phase 4 — Optimisation du moteur RAG et consolidation (28 juillet – 31 juillet 2026)

### Objectif  
Améliorer la précision de la recherche et la robustesse du système avant la démonstration MVP.

### Actions réalisées  
- **Chunking hybride** : conservation du Paragraph Chunker pour les documents longs, bascule en fixed-size (400 tokens, overlap 75) pour les documents courts.  
- **Recherche hybride locale** : ajout d'un index BM25 (`rank-bm25`) combiné à la recherche vectorielle ChromaDB.  
- **Extraction des faits avant génération** : étape GPT-5-mini pour extraire les faits pertinents des chunks, avec fallback automatique.  
- **Hiérarchie des normes scalable** : table de correspondance type/émetteur → force juridique (1 à 5).  
- **Retry automatique** sur les rate limits Azure (429).  
- **Persistance des métadonnées** dans `documents_meta.json`.  
- Réunions avec les experts métier : validation de la hiérarchie des normes et retour sur les orientations.  
- Tests de robustesse : séries G (10/10), H (10/10), I (10/10).  
- Correction des doublons dans `main.py` (erreur 422).  
- Nettoyage du dépôt Git, mise à jour du `.gitignore`, push sur Azure DevOps et GitHub.  

### Décisions clés  
- Le score de confiance reste basé sur la distance vectorielle, avec évolution prévue vers un score hybride.  
- La hiérarchie des normes doit être basée sur le type et l'émetteur, sans nom de fichier en dur.  

### Impact  
- Résolution définitive des échecs F4 (IML 91/75) et F5 (DORA simplified).  
- Le système répond correctement à des questions implicites, négatives, composites et multi-sources.  
- Le pipeline est stable et prêt pour la phase finale du MVP.  

### Points de blocage  
- `text-embedding-3-large` (modèle européen) non déployé par Francois.  
- Intégration Power Automate / Blob Storage en attente.  

---

## Synthèse des résultats

| Phase | Période | Résultat principal |
|-------|---------|--------------------|
| Phase 0 | 16/06 – 24/06 | Cadrage et maquettes validés |
| Phase 1 | 25/06 – 08/07 | Front-end connecté au RAG local |
| Phase 2 | 08/07 – 16/07 | RAG local fonctionnel, chunking validé |
| Phase 3 | 17/07 – 28/07 | Migration Azure, corpus 17 docs, E1-E8 8/8 |
| Phase 4 | 28/07 – 31/07 | Recherche hybride, tests G/H/I 10/10 |

## Prochaines étapes

1. Déploiement de `text-embedding-3-large` (dépendance Francois).  
2. Intégration du flux Power Automate / Blob Storage.  
3. Score de confiance hybride (vectoriel + BM25 + vérification).  
4. Affichage de la force juridique dans l'interface.  
5. Démo MVP et documentation utilisateur.