import sys
sys.path.insert(0, '.')
import os
import requests
from azure_search import SEARCH_ENDPOINT, SEARCH_INDEX, SEARCH_API_KEY, SEARCH_API_VERSION

# Créer le dossier sample_docs
os.makedirs('sample_docs', exist_ok=True)

documents = [
    ("00__Shared_Folders_Amethis_-_Risk_Management_99__Resources_Risk_in_Private_Equity_-_Oct_2015_pdf", "risk_private_equity.txt"),
    ("00__Shared_Folders_Amethis_-_Risk_Management_Amethis_Risk_Comptes_annuels_Signed_report_Amethis_Investment_Fund_Manager_S_A__31_12_17_pdf", "signed_report_amethis.txt"),
    ("1__Muinmos_01__Assessments_-_Creation_and_Completion_pdf", "assessments_creation.txt"),
    ("2__Invoices_123_Soleil_Advisory_S___r_l__-_BCP_-_477_2324_RC-2324-477-01_pdf", "rc_2324_477.txt"),
    ("1__Formation_externe_2__Documentation_1__AML_INDUNA_-_Anti-money_laundering_and_counter-terrorist_financing_171220_pptx", "induna_aml.txt"),
    ("2__Formation_interne_2021_-_Audit_Externe_Divers_knowledge_Knowledge_MAM_2018_MAM_2018_Group_Audit_ISA_600_T5_Group_audit_instructions_GAI_MAM_Update_2018_docx", "t5_audit_instructions.txt"),
    ("Engagement_letters_external_audit_Template_-_Engagement_letter_SA_SICAV_SIF_DOCX", "template_engagement_sicav.txt"),
    ("Engagement_letter_Internal_audit_Eurazeo_France_-_Offre_de_service_-_Externalisation_du_contr_le_p_riodique_2026-2028_pdf", "eurazeo_offre.txt"),
]

url = f'{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search?api-version={SEARCH_API_VERSION}'
headers = {'Content-Type': 'application/json', 'api-key': SEARCH_API_KEY}

for parent_id, output_file in documents:
    print(f"Récupération de {output_file}...")
    body = {
        'search': '*',
        'filter': f"parentId eq '{parent_id}'",
        'top': 200,
        'select': 'content,chunkIndex',
        'orderby': 'chunkIndex asc'
    }
    r = requests.post(url, headers=headers, json=body)
    if r.status_code == 200:
        chunks = r.json().get('value', [])
        full_text = '\n\n'.join([c.get('content', '') for c in chunks])
        filepath = os.path.join('sample_docs', output_file)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(full_text)
        print(f"  ✅ {len(chunks)} chunks, {len(full_text)} caractères -> {filepath}")
    else:
        print(f"  ❌ Erreur {r.status_code}: {r.text[:200]}")
    print()
