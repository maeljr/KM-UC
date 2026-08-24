from pypdf import PdfReader
reader = PdfReader('docs/cssf25_888eng.pdf')
text = ''
for page in reader.pages:
    t = page.extract_text()
    if t:
        text += t

keywords = ['capital', 'minimum', 'own funds', 'CASP', 'prudential', 'EUR', 'threshold', 'initial']
found = False
for line in text.split('\n'):
    line_lower = line.lower()
    if any(k.lower() in line_lower for k in keywords):
        if not found:
            print('=== cssf25_888eng.pdf - extraits pertinents ===')
            found = True
        print('  -> ' + line.strip()[:200])

if not found:
    print('Aucune mention de capital/minimum/CASP trouvée.')
    print('Le PDF contient ' + str(len(text.split())) + ' mots.')
