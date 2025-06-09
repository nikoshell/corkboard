import { serve } from "https://deno.land/std@0.208.0/http/server.ts"; 
import { STATUS_CODE } from "https://deno.land/std@0.208.0/http/status.ts"; 

// Types
interface Tweet {
  id: string;
  displayName: string;
  handle?: string;
  content: string;
  imageData?: string; // base64 encoded image
  imageType?: string; // image mime type
  timestamp: number;
  reactions: Record<string, number>;
}

interface TweetInput {
  displayName: string;
  handle?: string;
  content: string;
  image?: File;
}

interface ReactionInput {
  tweetId: string;
  reaction: string;
}

// Available reactions
const REACTIONS = [
  "👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "🚀", "👏", "🎉"
];

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
async function createTweet(request: Request): Promise<Response> {
  console.log("📝 Creating new tweet...");
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

    const tweetId = generateId();
    const tweet: Tweet = {
      id: tweetId,
      displayName,
      handle: handle || undefined,
      content,
      timestamp: Date.now(),
      reactions: initializeReactions()
    };

    console.log(`🆔 Generated tweet ID: ${tweetId}`);

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
        tweet.imageData = data;
        tweet.imageType = type;
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
    console.log("💾 Storing tweet in KV database...");
    try {
      await kv.set(["tweets", tweet.id], tweet);
      console.log("✅ Tweet stored successfully in KV");
    } catch (kvError) {
      console.error("❌ KV storage failed:", kvError);
      return new Response(
        JSON.stringify({ error: "Failed to store tweet", details: kvError.message }),
        { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
      );
    }

    // Broadcast over WebSocket
    broadcast({ type: "tweet-created", data: tweet });

    console.log(`🎉 Tweet created successfully: ${tweet.id}`);
    return new Response(
      JSON.stringify(tweet),
      { status: STATUS_CODE.Created, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to create tweet:", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to create tweet",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getTweets(): Promise<Response> {
  console.log("📋 Fetching all tweets...");
  try {
    const tweets: Tweet[] = [];
    const iter = kv.list({ prefix: ["tweets"] });
    console.log("🔍 Iterating through KV entries...");
    let count = 0;
    for await (const entry of iter) {
      tweets.push(entry.value as Tweet);
      count++;
    }
    console.log(`📊 Found ${count} tweets in database`);
    tweets.sort((a, b) => b.timestamp - a.timestamp);
    console.log("🔄 Tweets sorted by timestamp (newest first)");
    console.log("✅ Tweets fetched successfully");
    return new Response(
      JSON.stringify(tweets),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to get tweets:", error);
    console.error("Stack trace:", error.stack);
    return new Response(
      JSON.stringify({
        error: "Failed to get tweets",
        details: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function addReaction(request: Request): Promise<Response> {
  console.log("👍 Adding reaction to tweet...");
  try {
    console.log("📋 Parsing reaction request body...");
    const body = await request.json() as ReactionInput;
    const { tweetId, reaction } = body;
    console.log(`📊 Reaction data: tweetId="${tweetId}", reaction="${reaction}"`);

    if (!tweetId || !reaction) {
      console.log("❌ Validation failed: missing tweetId or reaction");
      return new Response(
        JSON.stringify({ error: "tweetId and reaction are required" }),
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

    const tweetEntry = await kv.get(["tweets", tweetId]);
    if (!tweetEntry.value) {
      console.log(`❌ Tweet not found: ${tweetId}`);
      return new Response(
        JSON.stringify({ error: "Tweet not found" }),
        { status: STATUS_CODE.NotFound, headers: { "Content-Type": "application/json" } }
      );
    }

    const tweet = tweetEntry.value as Tweet;
    const oldCount = tweet.reactions[reaction] || 0;
    tweet.reactions[reaction] = oldCount + 1;

    // Update in KV
    console.log("💾 Updating tweet in KV database...");
    try {
      await kv.set(["tweets", tweetId], tweet);
      console.log("✅ Tweet updated successfully in KV");
    } catch (kvError) {
      console.error("❌ KV update failed:", kvError);
      return new Response(
        JSON.stringify({ error: "Failed to update reaction", details: kvError.message }),
        { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
      );
    }

    // Broadcast updated tweet
    broadcast({ type: "reaction-added", data: tweet });

    console.log(`🎉 Reaction added successfully to tweet: ${tweetId}`);
    return new Response(
      JSON.stringify(tweet),
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

async function importTweets(request: Request): Promise<Response> {
  console.log("📥 Importing tweets from NDJSON...");
  try {
    const body = await request.text();
    const lines = body.trim().split('\n');
    let imported = 0;
    let failed = 0;
    console.log(`📄 Processing ${lines.length} lines from NDJSON...`);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        const tweetData = JSON.parse(line);
        const tweet: Tweet = {
          id: tweetData.id || generateId(),
          displayName: tweetData.displayName,
          handle: tweetData.handle,
          content: tweetData.content,
          imageData: tweetData.imageData,
          imageType: tweetData.imageType,
          timestamp: tweetData.timestamp || Date.now(),
          reactions: tweetData.reactions || initializeReactions()
        };
        await kv.set(["tweets", tweet.id], tweet);
        imported++;
      } catch (lineError) {
        failed++;
        console.error(`❌ Failed to parse line ${index + 1}:`, lineError.message);
      }
    }
    console.log(`🎉 Import completed: ${imported} successful, ${failed} failed`);
    return new Response(
      JSON.stringify({ message: `Imported ${imported} tweets`, successful: imported, failed: failed }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Failed to import tweets:", error);
    return new Response(
      JSON.stringify({ error: "Failed to import tweets", details: error.message }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function exportTweets(): Promise<Response> {
  console.log("📤 Exporting tweets to NDJSON...");
  try {
    const tweets: Tweet[] = [];
    const iter = kv.list({ prefix: ["tweets"] });
    for await (const entry of iter) {
      tweets.push(entry.value as Tweet);
    }
    tweets.sort((a, b) => a.timestamp - b.timestamp);
    const ndjson = tweets.map(tweet => JSON.stringify(tweet)).join('\n');
    console.log("✅ Export completed successfully");
    return new Response(ndjson, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": "attachment; filename=tweets.ndjson"
      }
    });
  } catch (error) {
    console.error("❌ Failed to export tweets:", error);
    return new Response(
      JSON.stringify({ error: "Failed to export tweets", details: error.message }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getImage(request: Request, tweetId: string): Promise<Response> {
  const tweetEntry = await kv.get(["tweets", tweetId]);
  if (!tweetEntry.value) {
    return new Response("Tweet not found", { status: STATUS_CODE.NotFound });
  }
  const tweet = tweetEntry.value as Tweet;
  if (!tweet.imageData || !tweet.imageType) {
    return new Response("Image not found", { status: STATUS_CODE.NotFound });
  }

  try {
    const imageBytes = Uint8Array.from(atob(tweet.imageData), c => c.charCodeAt(0));
    return new Response(imageBytes, {
      headers: {
        "Content-Type": tweet.imageType,
        "Cache-Control": "public, max-age=3600"
      }
    });
  } catch (decodeError) {
    console.error("❌ Failed to decode base64 image:", decodeError);
    return new Response("Failed to decode image", { status: STATUS_CODE.InternalServerError });
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

    socket.onClose = () => clients.delete(socket);
    return response;
  }

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let response: Response;

  try {
    if (request.method === "POST" && path === "/api/tweets") {
      response = await createTweet(request);
    } else if (request.method === "GET" && path === "/api/tweets") {
      response = await getTweets();
    } else if (request.method === "POST" && path === "/api/reactions") {
      response = await addReaction(request);
    } else if (request.method === "GET" && path === "/api/reactions") {
      response = await getReactions();
    } else if (request.method === "POST" && path === "/api/import") {
      response = await importTweets(request);
    } else if (request.method === "GET" && path === "/api/export") {
      response = await exportTweets();
    } else if (request.method === "GET" && path.startsWith("/api/images/")) {
      const tweetId = path.split("/").pop();
      response = tweetId ? await getImage(request, tweetId) : new Response("Invalid image path", { status: STATUS_CODE.BadRequest });
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
console.log("🚀 Twitter-like API server starting...");
console.log("📚 Available endpoints:");
console.log("  POST /api/tweets - Create a new tweet");
console.log("  GET  /api/tweets - Get all tweets");
console.log("  POST /api/reactions - Add reaction to tweet");
console.log("  GET  /api/reactions - Get available reactions");
console.log("  POST /api/import - Import tweets from NDJSON");
console.log("  GET  /api/export - Export tweets as NDJSON");
console.log("  GET  /api/images/:tweetId - Get tweet image");
console.log("  WS   /api/ws - Real-time updates via WebSocket");

await serve(handleRequest, { port: 8000 });
