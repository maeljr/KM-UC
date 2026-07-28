"""
Script de récupération de documents réglementaires.
Télécharge des PDFs depuis des URLs directes (EBA, ESMA, BCE, CSSF).
"""

import requests
import os
import time

# --- CONFIGURATION ---
DOCS_FOLDER = "./docs"
DELAY = 3  # secondes entre chaque téléchargement

# --- URLS DIRECTES DE PDFs PUBLICS ---
PDF_URLS = [
    # EBA Guidelines
    ("EBA", "https://www.eba.europa.eu/sites/default/files/2024-07/EBA-GL-2024-01-Guidelines-on-ESG-risks.pdf", "EBA_GL_ESG_Risks.pdf"),
    ("EBA", "https://www.eba.europa.eu/sites/default/files/2023-06/EBA-GL-2023-03-Guidelines-on-ICT-and-security-risk-management.pdf", "EBA_GL_ICT_Risk.pdf"),
    
    # ESMA Guidelines
    ("ESMA", "https://www.esma.europa.eu/sites/default/files/2024-01/ESMA50-164-7706_guidelines_on_market_risk_reporting.pdf", "ESMA_GL_Market_Risk.pdf"),
    
    # ECB publications
    ("ECB", "https://www.ecb.europa.eu/pub/pdf/other/ecb.guidelinesonoutsourcinganden.pdf", "ECB_GL_Outsourcing.pdf"),
    
    # CSSF (déjà dans docs/, mais on les garde pour référence)
    # Les 4 circulaires CSSF sont déjà présentes
]


def download_pdf(url, filename, source):
    """Télécharge un PDF et le sauvegarde dans docs/."""
    filepath = os.path.join(DOCS_FOLDER, filename)
    
    if os.path.exists(filepath):
        print(f"  → {filename} existe déjà, ignoré.")
        return True
    
    print(f"  ↓ Téléchargement de {filename}...")
    try:
        response = requests.get(url, timeout=30, stream=True)
        if response.status_code == 200:
            with open(filepath, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            size_kb = os.path.getsize(filepath) / 1024
            print(f"  ✓ {filename} ({size_kb:.0f} Ko)")
            return True
        else:
            print(f"  ✗ {filename} (status {response.status_code})")
            return False
    except Exception as e:
        print(f"  ✗ {filename} : {e}")
        return False


if __name__ == "__main__":
    os.makedirs(DOCS_FOLDER, exist_ok=True)
    print("=" * 50)
    print("  Téléchargement de documents réglementaires")
    print("=" * 50)
    
    success = 0
    for source, url, filename in PDF_URLS:
        print(f"\n📄 {source}")
        if download_pdf(url, filename, source):
            success += 1
        time.sleep(DELAY)
    
    print(f"\n✅ {success}/{len(PDF_URLS)} documents téléchargés dans '{DOCS_FOLDER}'.")
    print("Lance 'python main.py' pour réindexer.")