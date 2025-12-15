"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hey! My name is Chi-Chat, and I'm here to help with Southwest Virginia Chihuahua questions. To start, what's your first name?",
    },
  ]);
  const [input, setInput] = useState("");
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userMessage: Message = { role: "user", text: trimmed };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          customerName,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        console.error("Chat API error:", errJson || res.statusText);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text:
              "Sorry, I'm having trouble talking to the server right now. Please try again in a moment.",
          },
        ]);
        return;
      }

      const data = await res.json();

      const replyText =
        typeof data?.reply === "string"
          ? data.reply
          : "Sorry, I had trouble generating a reply.";

      // If server updated the customerName, keep it
      if (data?.customerName) {
        setCustomerName(data.customerName as string);
      }

      setMessages((prev) => [...prev, { role: "assistant", text: replyText }]);
    } catch (err) {
      console.error("Network error calling /api/chat:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            "Sorry, something went wrong reaching the server. Please check your connection and try again.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white shadow-xl rounded-2xl border border-slate-200">
        <header className="px-8 pt-6 pb-4 border-b border-slate-200 text-center">
          <h1 className="text-2xl font-semibold text-slate-800">
            Southwest Virginia Chihuahua Assistant
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            Ask Chi-Chat about puppies, pricing, policies, and care.
          </p>
        </header>

        <section className="px-4 sm:px-6 py-4">
          <div className="h-80 sm:h-96 bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-y-auto">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex mb-3 ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-emerald-500 text-white rounded-br-sm"
                      : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </section>

        <form onSubmit={handleSend} className="px-4 sm:px-6 pb-6 pt-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isSending}
              placeholder={
                isSending
                  ? "Chi-Chat is thinking..."
                  : "Ask Chi-Chat anything about puppies, policies, or care..."
              }
              className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 disabled:bg-slate-100 disabled:text-slate-400"
            />
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              className="px-4 py-2 rounded-full bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

