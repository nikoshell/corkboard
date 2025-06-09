import { serve } from "https://deno.land/std@0.208.0/http/server.ts"; 
import { STATUS_CODE } from "https://deno.land/std@0.208.0/http/status.ts"; 

// Types
interface Note {
  id: string;
  displayName: string;
  handle?: string;
  content: string;
  imageData?: string; // base64 encoded image
  imageType?: string; // image mime type
  timestamp: number;
  reactions: Record<string, number>;
}

interface NoteInput {
  displayName: string;
  handle?: string;
  content: string;
  image?: File;
}

interface ReactionInput {
  noteId: string;
  reaction: string;
}

// Available reactions
const REACTIONS = [
  "👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "🚀", "👏", "🎉"
];

// Initialize KV database
const kv = await Deno.openKv();
console.log("🗄️  Deno KV database initialized successfully");

// Utility functions
function generateId(): string {
  return crypto.randomUUID();
}

async function resizeImage(imageFile: File): Promise<{ data: string; type: string }> {
  const arrayBuffer = await imageFile.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  return {
    data: base64,
    type: imageFile.type
  };
}

function initializeReactions(): Record<string, number> {
  const reactions: Record<string, number> = {};
  REACTIONS.forEach(reaction => {
    reactions[reaction] = 0;
  });
  return reactions;
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
    const imageFile = formData.get("image") as File;

    console.log(`📊 Form data received: displayName="${displayName}", handle="${handle}", content length=${content?.length || 0}, image=${imageFile ? `${imageFile.name} (${imageFile.size} bytes)` : 'none'}`);

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

    // Handle image if provided
    if (imageFile && imageFile.size > 0) {
      console.log(`🖼️  Processing image: ${imageFile.name} (${imageFile.type}, ${imageFile.size} bytes)`);
      if (!imageFile.type.startsWith("image/")) {
        console.log(`❌ Invalid file type: ${imageFile.type}`);
        return new Response(
          JSON.stringify({ error: "File must be an image" }),
          { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
        );
      }
      try {
        const { data, type } = await resizeImage(imageFile);
        note.imageData = data;
        note.imageType = type;
        console.log(`✅ Image processed successfully: ${type}, ${data.length} chars base64`);
      } catch (imageError) {
        console.error("❌ Image processing failed:", imageError);
        return new Response(
          JSON.stringify({ error: "Failed to process image", details: imageError.message }),
          { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
        );
      }
    }

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
    // Sort by timestamp (newest first)
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

    // Get note from KV
    console.log(`🔍 Looking up note: ${noteId}`);
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
    console.log(`📈 Reaction "${reaction}" count: ${oldCount} → ${note.reactions[reaction]}`);

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

async function importNotes(request: Request): Promise<Response> {
  console.log("📥 Importing notes from NDJSON...");
  try {
    const body = await request.text();
    const lines = body.trim().split('\n');
    let imported = 0;
    let failed = 0;
    console.log(`📄 Processing ${lines.length} lines from NDJSON...`);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) {
        console.log(`⏭️  Skipping empty line ${index + 1}`);
        continue;
      }
      try {
        console.log(`📝 Processing line ${index + 1}: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
        const noteData = JSON.parse(line);
        const note: Note = {
          id: noteData.id || generateId(),
          displayName: noteData.displayName,
          handle: noteData.handle,
          content: noteData.content,
          imageData: noteData.imageData,
          imageType: noteData.imageType,
          timestamp: noteData.timestamp || Date.now(),
          reactions: noteData.reactions || initializeReactions()
        };
        console.log(`💾 Storing note: ${note.id} by ${note.displayName}`);
        await kv.set(["notes", note.id], note);
        imported++;
        console.log(`✅ Note ${note.id} imported successfully`);
      } catch (lineError) {
        failed++;
        console.error(`❌ Failed to parse line ${index + 1}:`, lineError.message);
        console.error(`   Line content: ${line}`);
      }
    }
    console.log(`🎉 Import completed: ${imported} successful, ${failed} failed`);
    return new Response(
      JSON.stringify({
        message: `Imported ${imported} notes`,
        successful: imported,
        failed: failed,
        total: lines.length
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to import notes:", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to import notes",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function exportNotes(): Promise<Response> {
  console.log("📤 Exporting notes to NDJSON...");
  try {
    const notes: Note[] = [];
    const iter = kv.list({ prefix: ["notes"] });
    console.log("🔍 Collecting notes from KV...");
    let count = 0;
    for await (const entry of iter) {
      notes.push(entry.value as Note);
      count++;
    }
    console.log(`📊 Found ${count} notes to export`);
    // Sort by timestamp
    notes.sort((a, b) => a.timestamp - b.timestamp);
    console.log("🔄 Notes sorted by timestamp (oldest first for export)");
    // Convert to NDJSON
    const ndjson = notes.map(note => JSON.stringify(note)).join('\n');
    console.log(`📝 Generated NDJSON: ${ndjson.length} characters`);
    console.log("✅ Export completed successfully");
    return new Response(
      ndjson,
      {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": "attachment; filename=notes.ndjson"
        }
      }
    );
  } catch (error) {
    console.error("❌ Failed to export notes:", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to export notes",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getImage(request: Request, noteId: string): Promise<Response> {
  console.log(`🖼️  Fetching image for note: ${noteId}`);
  try {
    console.log(`🔍 Looking up note in KV: ${noteId}`);
    const noteEntry = await kv.get(["notes", noteId]);
    if (!noteEntry.value) {
      console.log(`❌ Note not found: ${noteId}`);
      return new Response("Note not found", { status: STATUS_CODE.NotFound });
    }
    const note = noteEntry.value as Note;
    if (!note.imageData || !note.imageType) {
      console.log(`❌ No image data found for note: ${noteId}`);
      return new Response("Image not found", { status: STATUS_CODE.NotFound });
    }
    console.log(`📊 Image found: ${note.imageType}, ${note.imageData.length} chars base64`);
    // Decode base64 image
    console.log("🔄 Decoding base64 image data...");
    try {
      const imageBytes = Uint8Array.from(atob(note.imageData), c => c.charCodeAt(0));
      console.log(`✅ Image decoded successfully: ${imageBytes.length} bytes`);
      return new Response(
        imageBytes,
        {
          headers: {
            "Content-Type": note.imageType,
            "Cache-Control": "public, max-age=3600"
          }
        }
      );
    } catch (decodeError) {
      console.error("❌ Failed to decode base64 image:", decodeError);
      return new Response("Failed to decode image", { status: STATUS_CODE.InternalServerError });
    }
  } catch (error) {
    console.error(`❌ Failed to get image for note ${noteId}:`, error);
    console.error("Stack trace:", error.stack);
    return new Response("Failed to get image", { status: STATUS_CODE.InternalServerError });
  }
}

async function getReactions(): Promise<Response> {
  return new Response(
    JSON.stringify({ reactions: REACTIONS }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// Router
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  console.log(`🌐 ${method} ${path} - ${new Date().toISOString()}`);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === "OPTIONS") {
    console.log("✅ CORS preflight request handled");
    return new Response(null, { headers: corsHeaders });
  }

  let response: Response;
  try {
    if (method === "POST" && path === "/api/notes") {
      response = await createNote(request);
    } else if (method === "GET" && path === "/api/notes") {
      response = await getNotes();
    } else if (method === "POST" && path === "/api/reactions") {
      response = await addReaction(request);
    } else if (method === "GET" && path === "/api/reactions") {
      console.log("📋 Returning available reactions");
      response = await getReactions();
    } else if (method === "POST" && path === "/api/import") {
      response = await importNotes(request);
    } else if (method === "GET" && path === "/api/export") {
      response = await exportNotes();
    } else if (method === "GET" && path.startsWith("/api/images/")) {
      const noteId = path.split("/").pop();
      if (noteId) {
        response = await getImage(request, noteId);
      } else {
        console.log("❌ Invalid image path - no note ID provided");
        response = new Response("Invalid image path", { status: STATUS_CODE.BadRequest });
      }
    } else {
      console.log(`❌ Route not found: ${method} ${path}`);
      response = new Response("Not Found", { status: STATUS_CODE.NotFound });
    }
  } catch (error) {
    console.error(`❌ Unhandled error in request handler:`, error);
    console.error("Stack trace:", error.stack);
    response = new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: STATUS_CODE.InternalServerError,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Add CORS headers to response
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  console.log(`✅ Response: ${response.status} ${response.statusText}`);
  return response;
}

// Start server
console.log("🚀 Note-taking API server starting...");
console.log("📚 Available endpoints:");
console.log("  POST /api/notes - Create a new note (multipart/form-data)");
console.log("  GET  /api/notes - Get all notes");
console.log("  POST /api/reactions - Add reaction to note");
console.log("  GET  /api/reactions - Get available reactions");
console.log("  POST /api/import - Import notes from NDJSON");
console.log("  GET  /api/export - Export notes as NDJSON");
console.log("  GET  /api/images/:noteId - Get note image");

await serve(handleRequest, { port: 8000 });
