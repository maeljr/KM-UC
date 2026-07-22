// src/services/botService.ts

export interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
}

export interface SourceItem {
  source: string;
  chunk_index: number;
  text?: string;
  snippet?: string;
  content?: string;
  section?: string;
  score?: number;
}

export interface RagResponse {
  answer: string;
  confidence_score: number;
  sources: SourceItem[];
  confidence?: string;
  best_distance?: number;
}

export const botService = {
  async sendMessage(text: string): Promise<string> {
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      const data = await response.json();
      return data.answer || "L'assistant n'a pas trouvé de réponse.";
    } catch (error) {
      console.error("Erreur lors de l'appel au RAG :", error);
      return "Désolé, le service RAG est indisponible.";
    }
  }
};