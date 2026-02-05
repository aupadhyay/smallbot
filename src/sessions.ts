import type { Message } from "@mariozechner/pi-ai";

interface Session {
  messages: Message[];
  lastActivity: number;
}

const sessions = new Map<number, Session>();

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function getSession(userId: number): Session {
  let session = sessions.get(userId);
  if (!session) {
    session = { messages: [], lastActivity: Date.now() };
    sessions.set(userId, session);
  }
  session.lastActivity = Date.now();
  return session;
}

export function clearSession(userId: number) {
  sessions.delete(userId);
}

export function addMessage(userId: number, message: Message) {
  const session = getSession(userId);
  session.messages.push(message);
  session.lastActivity = Date.now();
}

// Cleanup idle sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(userId);
    }
  }
}, 5 * 60 * 1000);
