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

// Constants
const REACTIONS = [
  "👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "🚀", "👏", "🎉"
];

const ADMIN_TOKEN:string = Deno.env.get("ADMIN_TOKEN")!;


if (!ADMIN_TOKEN || ADMIN_TOKEN.trim() === "") {
  console.error("❌ GitHub Secret is not set or is empty.");
}

// Initialize
const app = new Hono();
const kv = await Deno.openKv();
const wsClients = new Set<WebSocket>();

console.log("🗄️  Deno KV database initialized successfully");
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
  return (ADMIN_TOKEN && token === ADMIN_TOKEN)? true : false; 
};

// Middleware
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Admin-Token"]
}));

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
app.get("/api/ws", upgradeWebSocket((c:any) => {
  return {
    onOpen: (evt:any, ws:any) => {
      wsClients.add(ws);
      console.log("🔌 WebSocket client connected");
    },
    onClose: (evt:any, ws:any) => {
      wsClients.delete(ws);
      console.log("🔌 WebSocket client disconnected");
    }
  };
}));

// Public routes
app.post("/api/notes", async (c:any):Promise<any> => {
  try {
    console.log("📝 Creating new note...");
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

    console.log(`✅ Note created: ${note.id}`);
    return c.json(note, 201);
  } catch (error:any) {
    console.error("❌ Failed to create note:", error);
    return c.json({ 
      error: "Failed to create note", 
      details: error.message 
    }, 500);
  }
});

app.get("/api/notes", async (c:any):Promise<any> => {
  try {
    console.log("📋 Fetching all notes...");
    const notes: Note[] = [];
    
    for await (const entry of kv.list({ prefix: ["notes"] })) {
      notes.push(entry.value as Note);
    }
    
    notes.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`✅ Found ${notes.length} notes`);
    return c.json(notes);
  } catch (error:any) {
    console.error("❌ Failed to get notes:", error);
    return c.json({ 
      error: "Failed to get notes", 
      details: error.message 
    }, 500);
  }
});

app.post("/api/reactions", async (c: any): Promise<any> => {
  try {
    console.log("👍 Adding reaction...");
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

    console.log(`✅ Reaction added to note: ${noteId}`);
    return c.json(note);
  } catch (error:any) {
    console.error("❌ Failed to add reaction:", error);
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
    console.log("🗑️  Processing delete request...");
    let body:any;
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

      console.log(`✅ Note deleted: ${noteId}`);
      return c.json({ message: "Note deleted successfully", noteId });
    } else {
      // Delete all notes
      let deletedCount = 0;
      for await (const entry of kv.list({ prefix: ["notes"] })) {
        await kv.delete(entry.key);
        deletedCount++;
      }

      broadcast({ type: "all-notes-deleted", data: { deletedCount } });

      console.log(`✅ All notes deleted. Count: ${deletedCount}`);
      return c.json({ message: "All notes deleted successfully", deletedCount });
    }
  } catch (error:any) {
    console.error("❌ Failed to delete note(s):", error);
    return c.json({ 
      error: "Failed to delete note(s)", 
      details: error.message 
    }, 500);
  }
});

app.post("/api/import", requireAuth, async (c) => {
  try {
    console.log("📥 Importing notes from NDJSON...");
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
      } catch (lineError:any) {
        failed++;
        console.error(`❌ Failed to parse line ${index + 1}:`, lineError.message);
      }
    }

    console.log(`✅ Import completed: ${imported} successful, ${failed} failed`);
    return c.json({ 
      message: `Imported ${imported} notes`, 
      successful: imported, 
      failed 
    });
  } catch (error:any) {
    console.error("❌ Failed to import notes:", error);
    return c.json({ 
      error: "Failed to import notes", 
      details: error.message 
    }, 500);
  }
});

app.get("/api/export", requireAuth, async (c) => {
  try {
    console.log("📤 Exporting notes to NDJSON...");
    const notes: Note[] = [];
    
    for await (const entry of kv.list({ prefix: ["notes"] })) {
      notes.push(entry.value as Note);
    }
    
    notes.sort((a, b) => a.timestamp - b.timestamp);
    const ndjson = notes.map(note => JSON.stringify(note)).join('\n');

    console.log("✅ Export completed successfully");
    return c.body(ndjson, 200, {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": "attachment; filename=notes.ndjson"
    });
  } catch (error:any) {
    console.error("❌ Failed to export notes:", error);
    return c.json({ 
      error: "Failed to export notes", 
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

// Start info
console.log("🚀 Note-taking API server starting...");
console.log("📚 Available endpoints:");
console.log("  POST /api/notes - Create a new note");
console.log("  GET  /api/notes - Get all notes");
console.log("  POST /api/reactions - Add reaction to note");
console.log("  GET  /api/reactions - Get available reactions");
console.log("  DELETE /api/notes - [ADMIN] Delete note(s)");
console.log("  POST /api/import - [ADMIN] Import notes from NDJSON");
console.log("  GET  /api/export - [ADMIN] Export notes as NDJSON");
console.log("  WS   /api/ws - Real-time updates via WebSocket");
console.log("");
console.log("🔐 Admin Authentication:");
console.log("  Set ADMIN_TOKEN environment variable to enable admin functions");
console.log("  Provide token via 'Authorization: Bearer <token>' or 'X-Admin-Token: <token>' header");

export default app;
