import { useState } from 'react';
import { botService, Message } from '@/services/botService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    // Ajouter le message utilisateur à l'écran
    const newUserMessage: Message = { id: Date.now().toString(), sender: 'user', text: input };
    setMessages((prev) => [...prev, newUserMessage]);
    setInput('');
    setIsSending(true);

    try {
      // Appel au service (le mock répond après 1s en local)
      const botResponseText = await botService.sendMessage(input);
      
      const newBotMessage: Message = { id: (Date.now() + 1).toString(), sender: 'bot', text: botResponseText };
      setMessages((prev) => [...prev, newBotMessage]);
    } catch (error) {
      console.error("Erreur communication bot:", error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px] border rounded-lg p-4 gap-4">
      <div className="flex-1 overflow-y-auto space-y-2">
        {messages.map((m) => (
          <div key={m.id} className={m.sender === 'user' ? 'text-right' : 'text-left'}>
            <span className={`px-3 py-1 rounded ${m.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>
              {m.text}
            </span>
          </div>
        ))}
        {isSending && <div className="text-sm text-gray-400 italic">Le bot analyse votre demande...</div>}
      </div>
      <div className="flex gap-2">
        <Input 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          placeholder="Posez votre question métier..."
          aria-label="Champ de saisie de votre question"
        />
        <Button onClick={handleSend} disabled={isSending}>Envoyer</Button>
      </div>
    </div>
  );
};