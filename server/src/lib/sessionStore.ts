import { Store, SessionData } from "express-session";
import { prisma } from "../db";

const DAY_MS = 24 * 60 * 60 * 1000;

export class PrismaSessionStore extends Store {
  async get(sid: string, callback: (err: any, session?: SessionData | null) => void) {
    try {
      const record = await prisma.session.findUnique({ where: { id: sid } });
      if (!record || record.expiresAt < new Date()) {
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(record.data));
    } catch (err) {
      callback(err);
    }
  }

  async set(sid: string, session: SessionData, callback?: (err?: any) => void) {
    try {
      const maxAge = session.cookie?.maxAge ?? DAY_MS;
      const expiresAt = new Date(Date.now() + maxAge);
      const data = JSON.stringify(session);
      await prisma.session.upsert({
        where: { id: sid },
        create: { id: sid, data, expiresAt },
        update: { data, expiresAt },
      });
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void) {
    try {
      await prisma.session.delete({ where: { id: sid } }).catch(() => {});
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async touch(sid: string, session: SessionData, callback?: (err?: any) => void) {
    try {
      const maxAge = session.cookie?.maxAge ?? DAY_MS;
      const expiresAt = new Date(Date.now() + maxAge);
      await prisma.session.update({ where: { id: sid }, data: { expiresAt } }).catch(() => {});
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}

export async function purgeExpiredSessions() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}
