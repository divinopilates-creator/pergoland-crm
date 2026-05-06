"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { toast } from "sonner";

interface Message {
  id: string;
  from_me: boolean;
  text: string;
  timestamp: number;
  type: string;
}

interface WhatsAppChatProps {
  phone: string;
  contactName: string;
}

export function WhatsAppChat({ phone, contactName }: WhatsAppChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`/api/whatsapp/${phone.replace(/\D/g, "")}`);
      const data = await res.json();
      if (data.messages) setMessages(data.messages);
    } catch {
      toast.error("No se pudo cargar la conversación");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMessages(); }, [phone]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInput("");
      await fetchMessages();
      toast.success("Mensaje enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Cargando conversación...</p>;

  if (messages.length === 0) return <p className="text-sm text-muted-foreground p-4">Sin mensajes aún.</p>;

  return (
    <div className="flex flex-col h-[420px]">
      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg) => (
          msg.text ? (
            <div key={msg.id} className={`flex ${msg.from_me ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.from_me
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
              }`}>
                {!msg.from_me && <p className="text-xs font-medium mb-0.5 opacity-70">{contactName}</p>}
                <p>{msg.text}</p>
                <p className={`text-xs mt-0.5 opacity-60 text-right`}>
                  {new Date(msg.timestamp * 1000).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ) : null
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Escribe un mensaje..."
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          disabled={sending}
        />
        <Button size="icon" onClick={handleSend} disabled={sending || !input.trim()} className="cursor-pointer shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
