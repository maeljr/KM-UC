from pypdf import PdfReader
reader = PdfReader('docs/cssf25_888eng.pdf')
text = ''
for page in reader.pages:
    t = page.extract_text()
    if t:
        text += t

# Chercher plus largement
terms = ['capital', 'minimum', 'own funds', 'CASP', 'prudential', 'EUR', 'threshold', 'initial', 'crypto', 'asset', 'virtual']
print('=== cssf25_888eng.pdf - recherche approfondie ===')
print('Mots totaux:', len(text.split()))
print()

for term in terms:
    count = text.lower().count(term.lower())
    if count > 0:
        print(term + ': ' + str(count) + ' occurrences')

# Extraire le début du texte pour comprendre la structure
print()
print('=== 500 premiers caracteres ===')
print(text[:500])
