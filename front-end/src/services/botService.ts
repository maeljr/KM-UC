// src/services/botService.ts

export interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
}

export interface SourceItem {
  source: string;
  url?: string;
  chunk_index?: number;
  snippet?: string;
  text?: string;
  content?: string;
  section?: string;
  score?: number;
  document_type?: string;
  business_line?: string;
  primary_topic?: string;
  tags?: string[];
  citation?: number;
  library?: string;
}

export interface RagResponse {
  answer: string;
  confidence?: string;
  confidence_score?: number;
  grounded?: boolean;
  sources?: SourceItem[];
  cited?: number[];
}

const API_URL = "/api/ask-azure";

export const botService = {
  async sendMessage(text: string): Promise<string> {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, lang: 'fr' }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Erreur API (${response.status}): ${errorText.slice(0, 200)}`);
        return "Désolé, le service RAG est indisponible.";
      }
      
      const data = await response.json();
      return data.answer || "L'assistant n'a pas trouvé de réponse.";
    } catch (error) {
      console.error("Erreur lors de l'appel au RAG :", error);
      return "Désolé, le service RAG est indisponible.";
    }
  }
};