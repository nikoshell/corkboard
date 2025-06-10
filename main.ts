import { serve } from "https://deno.land/std@0.208.0/http/server.ts"; 
import { STATUS_CODE } from "https://deno.land/std@0.208.0/http/status.ts"; 

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

interface DeleteRequest {
  token: string;
  noteId?: string; // Optional - if not provided, deletes all notes
}

// Available reactions
const REACTIONS = [
  "👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "🚀", "👏", "🎉"
];

// Admin token from environment variable
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN");

if (!ADMIN_TOKEN) {
  console.warn("⚠️  WARNING: ADMIN_TOKEN environment variable not set. Admin functions will be disabled.");
} else {
  console.log("🔐 Admin authentication enabled");
}

// Initialize KV database
const kv = await Deno.openKv();
console.log("🗄️  Deno KV database initialized successfully");

// WebSocket clients
const clients = new Set<WebSocket>();

function broadcast(data: any) {
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Utility functions
function generateId(): string {
  return crypto.randomUUID();
}

function initializeReactions(): Record<string, number> {
  const reactions: Record<string, number> = {};
  REACTIONS.forEach(reaction => {
    reactions[reaction] = 0;
  });
  return reactions;
}

function isValidAdminToken(token: string): boolean {
  if (!ADMIN_TOKEN) {
    return false;
  }
  return token === ADMIN_TOKEN;
}

function extractAuthToken(request: Request): string | null {
  // Try to get token from Authorization header (Bearer token)
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  
  // Try to get token from X-Admin-Token header
  const tokenHeader = request.headers.get("X-Admin-Token");
  if (tokenHeader) {
    return tokenHeader;
  }
  
  return null;
}

// API handlers
async function createNote(request: Request): Promise<Response> {
  console.log("📝 Creating new note...");
  try {
    console.log("📋 Parsing form data...");
    const formData = await request.formData();
    const displayName = formData.get("displayName") as string;
    const handle = formData.get("handle") as string;
    const content = formData.get("content") as string;

    console.log(`📊 Form data received: displayName="${displayName}", handle="${handle}", content length=${content?.length || 0}`);

    if (!displayName || !content) {
      console.log("❌ Validation failed: missing displayName or content");
      return new Response(
        JSON.stringify({ error: "displayName and content are required" }),
        { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
      );
    }

    const noteId = generateId();
    const note: Note = {
      id: noteId,
      displayName,
      handle: handle || undefined,
      content,
      timestamp: Date.now(),
      reactions: initializeReactions()
    };

    console.log(`🆔 Generated note ID: ${noteId}`);

    // Store in KV
    console.log("💾 Storing note in KV database...");
    try {
      await kv.set(["notes", note.id], note);
      console.log("✅ Note stored successfully in KV");
    } catch (kvError) {
      console.error("❌ KV storage failed:", kvError);
      return new Response(
        JSON.stringify({ error: "Failed to store note", details: kvError.message }),
        { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
      );
    }

    // Broadcast over WebSocket
    broadcast({ type: "note-created", data: note });

    console.log(`🎉 Note created successfully: ${note.id}`);
    return new Response(
      JSON.stringify(note),
      { status: STATUS_CODE.Created, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to create note:", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to create note",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getNotes(): Promise<Response> {
  console.log("📋 Fetching all notes...");
  try {
    const notes: Note[] = [];
    const iter = kv.list({ prefix: ["notes"] });
    console.log("🔍 Iterating through KV entries...");
    let count = 0;
    for await (const entry of iter) {
      notes.push(entry.value as Note);
      count++;
    }
    console.log(`📊 Found ${count} notes in database`);
    notes.sort((a, b) => b.timestamp - a.timestamp);
    console.log("🔄 Notes sorted by timestamp (newest first)");
    console.log("✅ Notes fetched successfully");
    return new Response(
      JSON.stringify(notes),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to get notes:", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to get notes",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function addReaction(request: Request): Promise<Response> {
  console.log("👍 Adding reaction to note...");
  try {
    console.log("📋 Parsing reaction request body...");
    const body = await request.json() as ReactionInput;
    const { noteId, reaction } = body;
    console.log(`📊 Reaction data: noteId="${noteId}", reaction="${reaction}"`);

    if (!noteId || !reaction) {
      console.log("❌ Validation failed: missing noteId or reaction");
      return new Response(
        JSON.stringify({ error: "noteId and reaction are required" }),
        { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!REACTIONS.includes(reaction)) {
      console.log(`❌ Invalid reaction: "${reaction}". Available: ${REACTIONS.join(", ")}`);
      return new Response(
        JSON.stringify({ error: "Invalid reaction", availableReactions: REACTIONS }),
        { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
      );
    }

    const noteEntry = await kv.get(["notes", noteId]);
    if (!noteEntry.value) {
      console.log(`❌ Note not found: ${noteId}`);
      return new Response(
        JSON.stringify({ error: "Note not found" }),
        { status: STATUS_CODE.NotFound, headers: { "Content-Type": "application/json" } }
      );
    }

    const note = noteEntry.value as Note;
    const oldCount = note.reactions[reaction] || 0;
    note.reactions[reaction] = oldCount + 1;

    // Update in KV
    console.log("💾 Updating note in KV database...");
    try {
      await kv.set(["notes", noteId], note);
      console.log("✅ Note updated successfully in KV");
    } catch (kvError) {
      console.error("❌ KV update failed:", kvError);
      return new Response(
        JSON.stringify({ error: "Failed to update reaction", details: kvError.message }),
        { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
      );
    }

    // Broadcast updated note
    broadcast({ type: "reaction-added", data: note });

    console.log(`🎉 Reaction added successfully to note: ${noteId}`);
    return new Response(
      JSON.stringify(note),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to add reaction:", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to add reaction",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function deleteNote(request: Request): Promise<Response> {
  console.log("🗑️  Processing delete request...");
  
  if (!ADMIN_TOKEN) {
    console.log("❌ Admin functionality disabled - no ADMIN_TOKEN set");
    return new Response(
      JSON.stringify({ error: "Admin functionality not available" }),
      { status: STATUS_CODE.ServiceUnavailable, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Extract token from request
    const token = extractAuthToken(request);
    
    if (!token) {
      console.log("❌ No authentication token provided");
      return new Response(
        JSON.stringify({ error: "Authentication token required. Provide token via Authorization header (Bearer) or X-Admin-Token header." }),
        { status: STATUS_CODE.Unauthorized, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!isValidAdminToken(token)) {
      console.log("❌ Invalid authentication token");
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { status: STATUS_CODE.Forbidden, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse request body to get noteId (if provided)
    let noteId: string | undefined;
    try {
      const body = await request.json();
      noteId = body.noteId;
    } catch {
      // If no body or invalid JSON, we'll delete all notes
    }

    if (noteId) {
      // Delete specific note
      console.log(`🗑️  Deleting specific note: ${noteId}`);
      
      const noteEntry = await kv.get(["notes", noteId]);
      if (!noteEntry.value) {
        console.log(`❌ Note not found: ${noteId}`);
        return new Response(
          JSON.stringify({ error: "Note not found" }),
          { status: STATUS_CODE.NotFound, headers: { "Content-Type": "application/json" } }
        );
      }

      await kv.delete(["notes", noteId]);
      
      // Broadcast deletion
      broadcast({ type: "note-deleted", data: { noteId } });
      
      console.log(`✅ Note deleted successfully: ${noteId}`);
      return new Response(
        JSON.stringify({ message: "Note deleted successfully", noteId }),
        { headers: { "Content-Type": "application/json" } }
      );
    } else {
      // Delete all notes
      console.log("🗑️  Deleting ALL notes...");
      
      let deletedCount = 0;
      const iter = kv.list({ prefix: ["notes"] });
      
      for await (const entry of iter) {
        await kv.delete(entry.key);
        deletedCount++;
      }
      
      // Broadcast mass deletion
      broadcast({ type: "all-notes-deleted", data: { deletedCount } });
      
      console.log(`✅ All notes deleted successfully. Count: ${deletedCount}`);
      return new Response(
        JSON.stringify({ message: "All notes deleted successfully", deletedCount }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("❌ Failed to delete note(s):", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to delete note(s)",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function importNotes(request: Request): Promise<Response> {
  console.log("📥 Importing notes from NDJSON...");
  try {
    const body = await request.text();
    const lines = body.trim().split('\n');
    let imported = 0;
    let failed = 0;
    console.log(`📄 Processing ${lines.length} lines from NDJSON...`);
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
      } catch (lineError) {
        failed++;
        console.error(`❌ Failed to parse line ${index + 1}:`, lineError.message);
      }
    }
    console.log(`🎉 Import completed: ${imported} successful, ${failed} failed`);
    return new Response(
      JSON.stringify({ message: `Imported ${imported} notes`, successful: imported, failed: failed }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to import notes:", error);
    return new Response(
      JSON.stringify({ error: "Failed to import notes", details: error.message }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function exportNotes(): Promise<Response> {
  console.log("📤 Exporting notes to NDJSON...");
  try {
    const notes: Note[] = [];
    const iter = kv.list({ prefix: ["notes"] });
    for await (const entry of iter) {
      notes.push(entry.value as Note);
    }
    notes.sort((a, b) => a.timestamp - b.timestamp);
    const ndjson = notes.map(note => JSON.stringify(note)).join('\n');
    console.log("✅ Export completed successfully");
    return new Response(ndjson, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": "attachment; filename=notes.ndjson"
      }
    });
  } catch (error) {
    console.error("❌ Failed to export notes:", error);
    return new Response(
      JSON.stringify({ error: "Failed to export notes", details: error.message }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getReactions(): Promise<Response> {
  return new Response(JSON.stringify({ reactions: REACTIONS }), {
    headers: { "Content-Type": "application/json" }
  });
}

// WebSocket handler
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/ws") {
    const { response, socket } = Deno.upgradeWebSocket(request);
    clients.add(socket);

    socket.onclose = () => clients.delete(socket);
    return response;
  }

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let response: Response;

  try {
    if (request.method === "POST" && path === "/api/notes") {
      response = await createNote(request);
    } else if (request.method === "GET" && path === "/api/notes") {
      response = await getNotes();
    } else if (request.method === "POST" && path === "/api/reactions") {
      response = await addReaction(request);
    } else if (request.method === "GET" && path === "/api/reactions") {
      response = await getReactions();
    } else if (request.method === "POST" && path === "/api/import") {
      response = await importNotes(request);
    } else if (request.method === "GET" && path === "/api/export") {
      response = await exportNotes();
    } else if (request.method === "DELETE" && path === "/api/notes") {
      response = await deleteNote(request);
    } else {
      response = new Response("Not Found", { status: STATUS_CODE.NotFound });
    }
  } catch (error) {
    console.error("Unhandled error:", error);
    response = new Response(JSON.stringify({ error: "Internal server error" }), {
      status: STATUS_CODE.InternalServerError,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Add CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

// Start server
console.log("🚀 Note-taking API server starting...");
console.log("📚 Available endpoints:");
console.log("  POST /api/notes - Create a new note");
console.log("  GET  /api/notes - Get all notes");
console.log("  POST /api/reactions - Add reaction to note");
console.log("  GET  /api/reactions - Get available reactions");
console.log("  POST /api/import - Import notes from NDJSON");
console.log("  GET  /api/export - Export notes as NDJSON");
console.log("  DELETE /api/notes - [ADMIN] Delete note(s) (requires authentication)");
console.log("  WS   /api/ws - Real-time updates via WebSocket");
console.log("");
console.log("🔐 Admin Authentication:");
console.log("  Set ADMIN_TOKEN environment variable to enable admin functions");
console.log("  Provide token via 'Authorization: Bearer <token>' or 'X-Admin-Token: <token>' header");

await serve(handleRequest, { port: 8000 });
