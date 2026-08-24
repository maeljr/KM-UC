// Service d'appel au backend RAG Azure AI Search.
// Appelle l'endpoint /ask-azure et retourne la réponse structurée.

export type Source = {
  source: string;
  url?: string;
  chunk_index?: number;
  snippet?: string;
  document_type?: string;
  business_line?: string;
  primary_topic?: string;
  tags?: string[];
  citation?: number;
  library?: string;
};

export type RagResponse = {
  answer: string;
  confidence?: string;
  confidence_score?: number;
  grounded?: boolean;
  sources?: Source[];
  cited?: number[];
};

const API_URL = "http://127.0.0.1:8000/ask-azure";

export async function sendMessage(prompt: string): Promise<string> {
  if (!prompt.trim()) {
    throw new Error("Question vide");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: prompt.trim(),
      lang: "fr",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur API (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data: RagResponse = await response.json();
  return data.answer || "Aucune réponse générée.";
}

export async function sendMessageWithSources(prompt: string): Promise<RagResponse> {
  if (!prompt.trim()) {
    throw new Error("Question vide");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: prompt.trim(),
      lang: "fr",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur API (${response.status}): ${errorText.slice(0, 200)}`);
  }

  return await response.json();
}