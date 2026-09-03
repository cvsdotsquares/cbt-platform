'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { aiApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Bot, X, Send, Sparkles } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AiAssistant() {
  const { accessToken } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I\'m your CBT AI Assistant. Ask me about exams, proctoring, questions, or results.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || !accessToken || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: userMsg }]);
    setLoading(true);
    try {
      const res = await aiApi.chat(accessToken, userMsg) as { reply: string };
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Sorry, I couldn\'t process that. Try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  if (!accessToken) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-2xl shadow-glow transition-transform hover:scale-105 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
        size="icon"
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </Button>

      {open && (
        <Card className="fixed inset-x-3 bottom-20 z-50 flex h-[min(440px,calc(100dvh-7rem))] w-auto flex-col overflow-hidden border-border/60 shadow-card-hover animate-fade-in-up sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[440px] sm:w-[min(380px,calc(100vw-3rem))]">
          <div className="flex items-center gap-3 border-b border-white/10 gradient-primary px-5 py-4 text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <span className="font-bold">AI Assistant</span>
              <p className="text-[11px] text-white/70">Powered by CBT Intelligence</p>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'gradient-primary text-white shadow-sm'
                    : 'border border-border/60 bg-card shadow-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                </span>
                Thinking...
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-2 border-t border-border/60 bg-card p-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Ask about exams, proctoring..."
              className="flex-1 border-0 bg-muted/40 shadow-none focus-visible:ring-1"
            />
            <Button size="icon" onClick={send} disabled={loading} className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
