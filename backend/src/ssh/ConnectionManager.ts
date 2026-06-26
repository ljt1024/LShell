import { randomUUID } from "node:crypto";
import type { ServerConfig } from "../models/protocol.js";
import { SSHSession } from "./SSHSession.js";

export class ConnectionManager {
  private readonly sessions = new Map<string, SSHSession>();

  async create(config: ServerConfig): Promise<SSHSession> {
    const session = new SSHSession(randomUUID(), config);
    await session.connect();
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): SSHSession | undefined {
    return this.sessions.get(sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    await session.close();
  }

  async sweepIdle(maxIdleMs: number): Promise<void> {
    const staleSessions = [...this.sessions.values()].filter((session) => session.idleMs > maxIdleMs);
    await Promise.all(staleSessions.map((session) => this.remove(session.id)));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.remove(sessionId)));
  }
}
