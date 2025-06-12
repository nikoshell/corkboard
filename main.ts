import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/deno'
import { cors } from 'hono/cors'

// Types
interface Note {
  id: string;
  displayName: string;
  handle?: string;
  content: string;
  timestamp: number;
  reactions: Record<string, number>;
}

interface NoteInput {
  displayName: string;
  handle?: string;
  content: string;
}

interface ReactionInput {
  noteId: string;
  reaction: string;
}

interface RateLimitEntry {
  count: number;
  lastRequest: number;
  blacklisted?: boolean;
  blacklistedAt?: number;
}

// Constants
const REACTIONS = [
  "👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "🚀", "👏", "🎉"
];

const ADMIN_TOKEN: string = Deno.env.get("ADMIN_TOKEN")!;

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // Max requests per window
const ABUSE_THRESHOLD = 100; // Blacklist after this many requests in window
const BLACKLIST_DURATION = 60 * 60 * 1000; // 1 hour

if (!ADMIN_TOKEN || ADMIN_TOKEN.trim() === "") {
  console.error("❌ ADMIN_TOKEN is not set or is empty.");
}

// Initialize
const app = new Hono();
const kv = await Deno.openKv();
const wsClients = new Set<WebSocket>();
const rateLimitMap = new Map<string, RateLimitEntry>();

console.log("🚀 Server initialized");
if (ADMIN_TOKEN) {
  console.log("🔐 Admin authentication enabled");
} else {
  console.warn("⚠️  WARNING: ADMIN_TOKEN not set. Admin functions disabled.");
}

// Utilities
const generateId = () => crypto.randomUUID();

const initializeReactions = (): Record<string, number> => {
  return Object.fromEntries(REACTIONS.map(r => [r, 0]));
};

const broadcast = (data: any) => {
  const message = JSON.stringify(data);
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

const extractToken = (c: any): string | null => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return c.req.header("X-Admin-Token") || null;
};

const isValidAdmin = (token: string): boolean => {
  return (ADMIN_TOKEN && token === ADMIN_TOKEN) ? true : false;
};

const getClientIP = (c: any): string => {
  // Try various headers for getting real client IP
  return c.req.header("CF-Connecting-IP") || 
         c.req.header("X-Forwarded-For")?.split(',')[0]?.trim() ||
         c.req.header("X-Real-IP") ||
         c.req.header("Remote-Addr") ||
         "unknown";
};

const checkRateLimit = (ip: string): { allowed: boolean; shouldBlacklist: boolean } => {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, lastRequest: now });
    return { allowed: true, shouldBlacklist: false };
  }

  // Check if IP is already blacklisted
  if (entry.blacklisted) {
    const timeSinceBlacklist = now - (entry.blacklistedAt || 0);
    if (timeSinceBlacklist < BLACKLIST_DURATION) {
      return { allowed: false, shouldBlacklist: false };
    } else {
      // Remove from blacklist after duration
      entry.blacklisted = false;
      entry.blacklistedAt = undefined;
      entry.count = 1;
      entry.lastRequest = now;
      rateLimitMap.set(ip, entry);
      console.log(`🔓 IP ${ip} removed from blacklist`);
      return { allowed: true, shouldBlacklist: false };
    }
  }

  // Reset counter if window has passed
  if (now - entry.lastRequest > RATE_LIMIT_WINDOW) {
    entry.count = 1;
    entry.lastRequest = now;
    rateLimitMap.set(ip, entry);
    return { allowed: true, shouldBlacklist: false };
  }

  entry.count++;
  entry.lastRequest = now;
  rateLimitMap.set(ip, entry);

  // Check for abuse
  if (entry.count > ABUSE_THRESHOLD) {
    entry.blacklisted = true;
    entry.blacklistedAt = now;
    rateLimitMap.set(ip, entry);
    console.log(`🚫 IP ${ip} blacklisted for abuse (${entry.count} requests)`);
    return { allowed: false, shouldBlacklist: true };
  }

  // Check normal rate limit
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, shouldBlacklist: false };
  }

  return { allowed: true, shouldBlacklist: false };
};

// Rate limiting middleware
const rateLimitMiddleware = async (c: any, next: any) => {
  const ip = getClientIP(c);
  const { allowed, shouldBlacklist } = checkRateLimit(ip);

  if (!allowed) {
    const entry = rateLimitMap.get(ip);
    if (entry?.blacklisted) {
      return c.json({ 
        error: "IP blacklisted due to abuse",
        retryAfter: BLACKLIST_DURATION / 1000
      }, 429);
    } else {
      return c.json({ 
        error: "Rate limit exceeded",
        retryAfter: RATE_LIMIT_WINDOW / 1000
      }, 429);
    }
  }

  await next();
};

// Middleware
app.use("/api/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Admin-Token"]
}));

// Apply rate limiting to all API routes
app.use("/api/*", rateLimitMiddleware);

// Auth middleware for admin routes
const requireAuth = async (c: any, next: any) => {
  if (!ADMIN_TOKEN) {
    return c.json({ error: "Admin functionality not available" }, 503);
  }

  const token = extractToken(c);
  if (!token) {
    return c.json({ 
      error: "Authentication required. Use Authorization header (Bearer) or X-Admin-Token header." 
    }, 401);
  }

  if (!isValidAdmin(token)) {
    return c.json({ error: "Invalid authentication token" }, 403);
  }

  await next();
};

// WebSocket endpoint
app.get("/ws", upgradeWebSocket((c: any) => {
  return {
    onOpen: (evt: any, ws: any) => {
      wsClients.add(ws);
    },
    onClose: (evt: any, ws: any) => {
      wsClients.delete(ws);
    }
  };
}));

// Public routes
app.post("/api/notes", async (c: any): Promise<any> => {
  try {
    const formData = await c.req.formData();
    const displayName = formData.get("displayName") as string;
    const handle = formData.get("handle") as string;
    const content = formData.get("content") as string;

    if (!displayName || !content) {
      return c.json({ error: "displayName and content are required" }, 400);
    }

    const note: Note = {
      id: generateId(),
      displayName,
      handle: handle || undefined,
      content,
      timestamp: Date.now(),
      reactions: initializeReactions()
    };

    await kv.set(["notes", note.id], note);
    broadcast({ type: "note-created", data: note });

    return c.json(note, 201);
  } catch (error: any) {
    console.error("Failed to create note:", error.message);
    return c.json({ 
      error: "Failed to create note", 
      details: error.message 
    }, 500);
  }
});

app.get("/api/notes", async (c: any): Promise<any> => {
  try {
    const notes: Note[] = [];
    
    for await (const entry of kv.list({ prefix: ["notes"] })) {
      notes.push(entry.value as Note);
    }
    
    notes.sort((a, b) => b.timestamp - a.timestamp);
    return c.json(notes);
  } catch (error: any) {
    console.error("Failed to get notes:", error.message);
    return c.json({ 
      error: "Failed to get notes", 
      details: error.message 
    }, 500);
  }
});

app.post("/api/reactions", async (c: any): Promise<any> => {
  try {
    const { noteId, reaction } = await c.req.json() as ReactionInput;

    if (!noteId || !reaction) {
      return c.json({ error: "noteId and reaction are required" }, 400);
    }

    if (!REACTIONS.includes(reaction)) {
      return c.json({ 
        error: "Invalid reaction", 
        availableReactions: REACTIONS 
      }, 400);
    }

    const noteEntry = await kv.get(["notes", noteId]);
    if (!noteEntry.value) {
      return c.json({ error: "Note not found" }, 404);
    }

    const note = noteEntry.value as Note;
    note.reactions[reaction] = (note.reactions[reaction] || 0) + 1;

    await kv.set(["notes", noteId], note);
    broadcast({ type: "reaction-added", data: note });

    return c.json(note);
  } catch (error: any) {
    console.error("Failed to add reaction:", error.message);
    return c.json({ 
      error: "Failed to add reaction", 
      details: error.message 
    }, 500);
  }
});

app.get("/api/reactions", (c) => {
  return c.json({ reactions: REACTIONS });
});

// Admin routes (protected)
app.delete("/api/notes", requireAuth, async (c) => {
  try {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const { noteId } = body;

    if (noteId) {
      // Delete specific note
      const noteEntry = await kv.get(["notes", noteId]);
      if (!noteEntry.value) {
        return c.json({ error: "Note not found" }, 404);
      }

      await kv.delete(["notes", noteId]);
      broadcast({ type: "note-deleted", data: { noteId } });

      return c.json({ message: "Note deleted successfully", noteId });
    } else {
      // Delete all notes
      let deletedCount = 0;
      for await (const entry of kv.list({ prefix: ["notes"] })) {
        await kv.delete(entry.key);
        deletedCount++;
      }

      broadcast({ type: "all-notes-deleted", data: { deletedCount } });

      return c.json({ message: "All notes deleted successfully", deletedCount });
    }
  } catch (error: any) {
    console.error("Failed to delete note(s):", error.message);
    return c.json({ 
      error: "Failed to delete note(s)", 
      details: error.message 
    }, 500);
  }
});

app.post("/api/import", requireAuth, async (c) => {
  try {
    const body = await c.req.text();
    const lines = body.trim().split('\n');
    let imported = 0;
    let failed = 0;

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        const noteData = JSON.parse(line);
        const note: Note = {
          id: noteData.id || generateId(),
          displayName: noteData.displayName,
          handle: noteData.handle,
          content: noteData.content,
          timestamp: noteData.timestamp || Date.now(),
          reactions: noteData.reactions || initializeReactions()
        };
        await kv.set(["notes", note.id], note);
        imported++;
      } catch (lineError: any) {
        failed++;
        console.error(`Failed to parse line ${index + 1}:`, lineError.message);
      }
    }

    return c.json({ 
      message: `Imported ${imported} notes`, 
      successful: imported, 
      failed 
    });
  } catch (error: any) {
    console.error("Failed to import notes:", error.message);
    return c.json({ 
      error: "Failed to import notes", 
      details: error.message 
    }, 500);
  }
});

app.get("/api/export", requireAuth, async (c) => {
  try {
    const notes: Note[] = [];
    
    for await (const entry of kv.list({ prefix: ["notes"] })) {
      notes.push(entry.value as Note);
    }
    
    notes.sort((a, b) => a.timestamp - b.timestamp);
    const ndjson = notes.map(note => JSON.stringify(note)).join('\n');

    return c.body(ndjson, 200, {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": "attachment; filename=notes.ndjson"
    });
  } catch (error: any) {
    console.error("Failed to export notes:", error.message);
    return c.json({ 
      error: "Failed to export notes", 
      details: error.message 
    }, 500);
  }
});

// Admin endpoint to view blacklisted IPs
app.get("/api/admin/blacklist", requireAuth, async (c) => {
    const blacklistedIPs: {
      ip: string;
      blacklistedAt: number;
      timeRemaining: number;
      requestCount: number;
    }[] = [];
  const now = Date.now();
  
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (entry.blacklisted) {
      const timeRemaining = BLACKLIST_DURATION - (now - (entry.blacklistedAt || 0));
      if (timeRemaining > 0) {
        blacklistedIPs.push({
          ip,
          blacklistedAt: entry.blacklistedAt,
          timeRemaining: Math.ceil(timeRemaining / 1000),
          requestCount: entry.count
        });
      }
    }
  }
  
  return c.json({ blacklistedIPs });
});

// Admin endpoint to manually blacklist/unblacklist IPs
app.post("/api/admin/blacklist", requireAuth, async (c) => {
  try {
    const { ip, action } = await c.req.json();
    
    if (!ip || !action) {
      return c.json({ error: "ip and action are required" }, 400);
    }
    
    if (action === "blacklist") {
      const entry = rateLimitMap.get(ip) || { count: 0, lastRequest: Date.now() };
      entry.blacklisted = true;
      entry.blacklistedAt = Date.now();
      rateLimitMap.set(ip, entry);
      console.log(`🚫 IP ${ip} manually blacklisted`);
      return c.json({ message: `IP ${ip} blacklisted successfully` });
    } else if (action === "unblacklist") {
      const entry = rateLimitMap.get(ip);
      if (entry) {
        entry.blacklisted = false;
        entry.blacklistedAt = undefined;
        rateLimitMap.set(ip, entry);
        console.log(`🔓 IP ${ip} manually unblacklisted`);
        return c.json({ message: `IP ${ip} unblacklisted successfully` });
      } else {
        return c.json({ error: "IP not found in rate limit records" }, 404);
      }
    } else {
      return c.json({ error: "Invalid action. Use 'blacklist' or 'unblacklist'" }, 400);
    }
  } catch (error: any) {
    console.error("Failed to manage blacklist:", error.message);
    return c.json({ 
      error: "Failed to manage blacklist", 
      details: error.message 
    }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
