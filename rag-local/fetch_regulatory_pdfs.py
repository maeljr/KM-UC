"""
Extraction de PDF réglementaires :
- IAASB Handbook 2025
- IFRS Standards
- CSSF Regulatory Framework

Usage :
    python fetch_regulatory_pdfs.py --target iaasb
    python fetch_regulatory_pdfs.py --target ifrs
    python fetch_regulatory_pdfs.py --target cssf
    python fetch_regulatory_pdfs.py --target all
"""

import os
import re
import argparse
import requests
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

# Dossier de sortie
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "regulatory_pdfs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}


def download_pdf(url, filename=None):
    """Télécharge un PDF et le sauvegarde dans OUTPUT_DIR."""
    if not filename:
        filename = os.path.basename(urlparse(url).path)
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
    filepath = os.path.join(OUTPUT_DIR, filename)
    try:
        r = requests.get(url, headers=HEADERS, timeout=60)
        r.raise_for_status()
        with open(filepath, "wb") as f:
            f.write(r.content)
        print(f"  ✅ {filename} ({len(r.content)} octets)")
    except Exception as e:
        print(f"  ❌ {filename} : {e}")


def get_soup(url):
    """Récupère le HTML et retourne le BeautifulSoup."""
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return BeautifulSoup(r.text, "html.parser")


def extract_iaasb():
    print("=== IAASB Handbook 2025 ===")
    url = "https://www.iaasb.org/publications/2025-handbook-international-quality-management-auditing-review-other-assurance-and-related-services"
    soup = get_soup(url)
    # Cherche les liens PDF directement
    links = soup.select("a[href*='.pdf']")
    if links:
        for link in links[:3]:
            href = link.get("href")
            full_url = urljoin(url, href)
            download_pdf(full_url)
    else:
        # Fallback : chercher un bouton de téléchargement
        download_links = soup.select("a[href*='download'], a[href*='publication']")
        for link in download_links[:5]:
            print(f"  → {link.get('href')}")
        print("  ⚠️ Aucun PDF direct trouvé. Vérifie la page manuellement.")


def extract_ifrs():
    print("=== IFRS Standards ===")
    url = "https://www.ifrs.org/issued-standards/list-of-standards/"
    soup = get_soup(url)
    # Les standards sont souvent dans des listes ou des liens vers des pages dédiées
    links = soup.select("a[href*='issued-standards'], a[href*='ifrs']")
    seen = set()
    for link in links:
        href = link.get("href")
        if not href:
            continue
        full_url = urljoin(url, href)
        if full_url in seen:
            continue
        seen.add(full_url)
        # On ne télécharge que les PDF directs
        if href.lower().endswith(".pdf"):
            download_pdf(full_url)
        else:
            # On explore la page du standard pour trouver le PDF
            try:
                std_soup = get_soup(full_url)
                pdf_links = std_soup.select("a[href*='.pdf']")
                for pdf in pdf_links[:2]:
                    pdf_url = urljoin(full_url, pdf.get("href"))
                    download_pdf(pdf_url)
            except Exception:
                continue


def extract_cssf():
    print("=== CSSF Regulatory Framework ===")
    url = "https://www.cssf.lu/en/regulatory-framework/"
    soup = get_soup(url)
    # La CSSF utilise souvent des liens vers des pages thématiques puis des PDF
    links = soup.select("a[href*='regulatory'], a[href*='cssf'], a[href*='.pdf']")
    seen = set()
    for link in links:
        href = link.get("href")
        if not href:
            continue
        full_url = urljoin(url, href)
        if full_url in seen:
            continue
        seen.add(full_url)
        if href.lower().endswith(".pdf"):
            download_pdf(full_url)
        else:
            # On explore la page pour chercher des PDF
            try:
                sub_soup = get_soup(full_url)
                pdf_links = sub_soup.select("a[href*='.pdf']")
                for pdf in pdf_links[:3]:
                    pdf_url = urljoin(full_url, pdf.get("href"))
                    download_pdf(pdf_url)
            except Exception:
                continue


def main():
    parser = argparse.ArgumentParser(description="Extraction de PDF réglementaires")
    parser.add_argument("--target", choices=["iaasb", "ifrs", "cssf", "all"], default="all")
    args = parser.parse_args()

    if args.target in ("iaasb", "all"):
        extract_iaasb()
    if args.target in ("ifrs", "all"):
        extract_ifrs()
    if args.target in ("cssf", "all"):
        extract_cssf()

    print(f"\n📁 PDF sauvegardés dans : {OUTPUT_DIR}")


if __name__ == "__main__":
    main()