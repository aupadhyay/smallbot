import type { Message } from "@mariozechner/pi-ai";

export interface Session {
  messages: Message[];
  lastActivity: number;
}

const sessions = new Map<number, Session>();

type PreClearHook = (userId: number, session: Session) => Promise<void>;
let preClearHook: PreClearHook | null = null;

export function onBeforeClear(hook: PreClearHook) {
  preClearHook = hook;
}

export function getSession(userId: number): Session {
  let session = sessions.get(userId);
  if (!session) {
    session = { messages: [], lastActivity: Date.now() };
    sessions.set(userId, session);
  }
  session.lastActivity = Date.now();
  return session;
}

export async function clearSession(userId: number) {
  const session = sessions.get(userId);
  if (session && session.messages.length > 0 && preClearHook) {
    try {
      await preClearHook(userId, session);
    } catch (e: any) {
      // Don't block clearing if hook fails
    }
  }
  sessions.delete(userId);
}

export function addMessage(userId: number, message: Message) {
  const session = getSession(userId);
  session.messages.push(message);
  session.lastActivity = Date.now();
}
