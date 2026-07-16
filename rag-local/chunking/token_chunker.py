def chunk_text(text, max_tokens=512):
    """Découpe le texte en chunks basés sur un nombre estimé de tokens."""
    words = text.split()
    max_words = int(max_tokens * 0.75)
    chunks = []
    for i in range(0, len(words), max_words):
        chunk = " ".join(words[i : i + max_words])
        chunks.append(chunk)
    return chunks
