"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, FileText, Image as ImageIcon, Paperclip, Send, X } from "lucide-react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";

type ChatMessage = {
  id: string;
  sender_role: "consumer" | "business_owner";
  sender_name: string;
  message_type: "text" | "photo" | "pdf" | "delivery_alert";
  body?: string;
  attachment_name?: string;
  attachment_content_type?: string;
  attachment_data?: string;
  created_at: string;
};

type Chat = {
  store_name: string;
  customer_name: string;
  messages: ChatMessage[];
  other_typing: boolean;
};

export function OrderChat({ orderId, storeId, customerName, close }: { orderId: string; storeId: string; customerName: string; close: () => void }) {
  const [chat, setChat] = useState<Chat>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const api = createAuthenticatedWebApi("/api/ecochef");

  const load = useCallback(async () => {
    try {
      const result = await api.getOrderChat<Chat>(orderId, storeId);
      setChat(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The conversation could not be loaded.");
    }
  }, [orderId, storeId]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 2000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat?.messages.length, chat?.other_typing]);
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); void api.setOrderChatTyping(orderId, storeId, false); }, [orderId, storeId]);

  const notifyTyping = () => {
    void api.setOrderChatTyping(orderId, storeId, true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => void api.setOrderChatTyping(orderId, storeId, false), 1800);
  };

  const sendText = async () => {
    if (!message.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await api.sendOrderChatMessage(orderId, storeId, { message_type: "text", body: message.trim() });
      setMessage("");
      await api.setOrderChatTyping(orderId, storeId, false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The message could not be sent."); }
    finally { setBusy(false); }
  };

  const sendFile = async (file?: File) => {
    if (!file || busy) return;
    const isPhoto = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    const isPdf = file.type === "application/pdf";
    if (!isPhoto && !isPdf) { setError("Choose a JPEG, PNG, WebP, or PDF file."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("Attachments must be 8 MB or smaller."); return; }
    setBusy(true); setError("");
    try {
      const data = await readFileBase64(file);
      await api.sendOrderChatMessage(orderId, storeId, { message_type: isPhoto ? "photo" : "pdf", attachment_name: file.name, attachment_content_type: file.type, attachment_data: data });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The attachment could not be sent."); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop"><section className="modal-card order-chat-dialog" role="dialog" aria-label={`Chat with ${customerName}`}>
    <header className="order-chat-head"><div><span className="chat-avatar">{customerName.slice(0, 1).toUpperCase()}</span><div><h2>{customerName}</h2><small>Paid order #{orderId.slice(0, 8).toUpperCase()}</small></div></div><button aria-label="Close chat" onClick={close}><X /></button></header>
    <div className="chat-messages" aria-live="polite">
      {!chat?.messages.length ? <div className="chat-welcome"><span><Send size={18} /></span><b>Start the conversation</b><p>Use this private chat to help {customerName} with their paid order.</p></div> : null}
      {chat?.messages.map((item) => <ChatBubble key={item.id} message={item} />)}
      {chat?.other_typing ? <div className="typing-row"><span /><span /><span /><small>{customerName} is typing</small></div> : null}
      <div ref={endRef} />
    </div>
    {error ? <p className="chat-error" role="alert">{error}</p> : null}
    <footer className="chat-composer"><label className="attachment-button" aria-label="Send photo or PDF"><Paperclip size={18} /><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={(event) => { void sendFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><textarea rows={1} maxLength={2000} value={message} onChange={(event) => { setMessage(event.target.value); notifyTyping(); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendText(); } }} placeholder="Message customer…" /><button className="chat-send" aria-label="Send message" disabled={busy || !message.trim()} onClick={() => void sendText()}><Send size={18} /></button></footer>
  </section></div>;
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.message_type === "delivery_alert") return <div className="delivery-alert-bubble"><div className="delivery-alert-heading"><BellRing size={16} aria-hidden="true" /><b>{message.body || "Order update"}</b></div><small>{formatTime(message.created_at)}</small></div>;
  const mine = message.sender_role === "business_owner";
  const dataUrl = message.attachment_data && message.attachment_content_type ? `data:${message.attachment_content_type};base64,${message.attachment_data}` : "";
  return <div className={`chat-bubble-row ${mine ? "mine" : "theirs"}`}><div className="chat-bubble">
    {message.message_type === "photo" && dataUrl ? <a className="chat-photo" href={dataUrl} target="_blank" rel="noreferrer"><img src={dataUrl} alt={message.attachment_name || "Shared photo"} /><span><ImageIcon size={14} /> {message.attachment_name}</span></a> : null}
    {message.message_type === "pdf" && dataUrl ? <a className="chat-pdf" href={dataUrl} download={message.attachment_name || "document.pdf"}><FileText size={22} /><span><b>{message.attachment_name}</b><small>PDF document</small></span></a> : null}
    {message.body ? <p>{message.body}</p> : null}<small>{formatTime(message.created_at)}</small>
  </div></div>;
}

function formatTime(value: string) { return new Date(value).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }); }
function readFileBase64(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("The selected file could not be read.")); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.readAsDataURL(file); }); }
