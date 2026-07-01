// src/services/botService.ts

// Interface pour typer nos messages
export interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
}

/**
 * Service pour interagir avec le bot.
 * En prod, il appellera l'API Azure Function. 
 * En local, il simule une réponse.
 */
export const botService = {
  
  // 1. Récupération du token
  async getToken(): Promise<string> {
    if (import.meta.env.DEV) return "mock-token-123";
    
    const response = await fetch('/api/getDirectLineToken');
    const data = await response.json();
    return data.token;
  },

  // 2. Envoi de message
  async sendMessage(text: string): Promise<string> {
    if (import.meta.env.DEV) {
      // Simulation d'un délai réseau de 1 seconde
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return `[Mock] Réponse à votre question : "${text}". Le système est opérationnel.`;
    }

    // Ici, vous implémenterez l'appel réel via l'API Direct Line
    // const token = await this.getToken();
    // ... implémentation avec la librairie 'botframework-directlinejs'
    return "Connexion réelle à Direct Line non configurée.";
  }
};