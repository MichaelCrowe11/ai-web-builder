// Real authentication: bcrypt password hashing + express-session cookies.
// Replaces the prior unsalted SHA-256 scheme. Sessions persist in Postgres
// (connect-pg-simple) when DATABASE_URL is set, else an in-memory store.
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import createMemoryStore from "memorystore";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // bcrypt hashes start with $2; if we ever see a legacy hash, treat as mismatch.
  if (!hash.startsWith("$2")) return false;
  return bcrypt.compare(password, hash);
}

// Augment the session type so req.session.userId is typed.
declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

export function setupSession(app: Express) {
  const dbUrl = process.env.DATABASE_URL;
  const secret =
    process.env.SESSION_SECRET ?? "dev-insecure-secret-change-in-production";
  const isProd = process.env.NODE_ENV === "production";

  let store: session.Store;
  if (dbUrl) {
    const PgStore = connectPgSimple(session);
    // Cloud Run reaches Cloud SQL over a unix socket, not TCP. There DATABASE_URL
    // carries host=localhost (creds + db name only) and the socket dir lives in
    // DB_SOCKET_PATH — the same colon-free symlink storage.ts connects through.
    // node-postgres (which connect-pg-simple uses) switches to socket mode when
    // host starts with "/", so when DB_SOCKET_PATH is set we hand it a conObject
    // with that socket host instead of the localhost conString. Unset on
    // Railway/local, so it falls back to conString and behavior is unchanged.
    const socketPath = process.env.DB_SOCKET_PATH;
    const pgOptions: Record<string, unknown> = {
      tableName: "user_sessions",
      createTableIfMissing: true,
    };
    if (socketPath) {
      const u = new URL(dbUrl);
      pgOptions.conObject = {
        host: socketPath,
        port: 5432,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, ""),
      };
    } else {
      pgOptions.conString = dbUrl;
    }
    store = new PgStore(pgOptions as never);
  } else {
    const MemoryStore = createMemoryStore(session);
    store = new MemoryStore({ checkPeriod: 86_400_000 }); // prune daily
  }

  app.set("trust proxy", 1); // Railway terminates TLS at the edge
  app.use(
    session({
      store,
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      },
    }),
  );
}

// Gate a route behind a valid session.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}
