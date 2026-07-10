// src/services/botService.ts

export interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
}

export const botService = {
  
  async sendMessage(text: string): Promise<string> {
    // En développement : appel à l'API RAG locale
    if (import.meta.env.DEV) {
      try {
        const response = await fetch('http://localhost:8000/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text }),
        });

        if (!response.ok) {
          throw new Error(`Erreur API RAG : ${response.status}`);
        }

        const data = await response.json();
        return data.answer || "L'assistant n'a pas trouvé de réponse.";
      } catch (error) {
        console.error("Erreur lors de l'appel au RAG local :", error);
        return "Désolé, le service RAG local est indisponible. Vérifiez que le serveur tourne sur http://localhost:8000.";
      }
    }

    // En production : appel au vrai service (Azure / Direct Line)
    return "Connexion réelle à Direct Line non configurée.";
  }
};