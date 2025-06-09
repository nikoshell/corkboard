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
  try {
    const formData = await request.formData();
    const displayName = formData.get("displayName") as string;
    const handle = formData.get("handle") as string;
    const content = formData.get("content") as string;
    const imageFile = formData.get("image") as File;

    if (!displayName || !content) {
      return new Response(
        JSON.stringify({ error: "displayName and content are required" }),
        { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
      );
    }

    const tweet: Tweet = {
      id: generateId(),
      displayName,
      handle: handle || undefined,
      content,
      timestamp: Date.now(),
      reactions: initializeReactions()
    };

    // Handle image if provided
    if (imageFile && imageFile.size > 0) {
      if (!imageFile.type.startsWith("image/")) {
        return new Response(
          JSON.stringify({ error: "File must be an image" }),
          { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
        );
      }

      const { data, type } = await resizeImage(imageFile);
      tweet.imageData = data;
      tweet.imageType = type;
    }

    // Store in KV
    await kv.set(["tweets", tweet.id], tweet);

    return new Response(
      JSON.stringify(tweet),
      { status: STATUS_CODE.Created, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to create tweet." }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getTweets(): Promise<Response> {
  try {
    const tweets: Tweet[] = [];
    const iter = kv.list({ prefix: ["tweets"] });
    
    for await (const entry of iter) {
      tweets.push(entry.value as Tweet);
    }

    // Sort by timestamp (newest first)
    tweets.sort((a, b) => b.timestamp - a.timestamp);

    return new Response(
      JSON.stringify(tweets),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to get tweets" }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function addReaction(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ReactionInput;
    const { tweetId, reaction } = body;

    if (!tweetId || !reaction) {
      return new Response(
        JSON.stringify({ error: "tweetId and reaction are required" }),
        { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!REACTIONS.includes(reaction)) {
      return new Response(
        JSON.stringify({ error: "Invalid reaction", availableReactions: REACTIONS }),
        { status: STATUS_CODE.BadRequest, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get tweet from KV
    const tweetEntry = await kv.get(["tweets", tweetId]);
    if (!tweetEntry.value) {
      return new Response(
        JSON.stringify({ error: "Tweet not found" }),
        { status: STATUS_CODE.NotFound, headers: { "Content-Type": "application/json" } }
      );
    }

    const tweet = tweetEntry.value as Tweet;
    tweet.reactions[reaction] = (tweet.reactions[reaction] || 0) + 1;

    // Update in KV
    await kv.set(["tweets", tweetId], tweet);

    return new Response(
      JSON.stringify(tweet),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to add reaction" }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function importTweets(request: Request): Promise<Response> {
  try {
    const body = await request.text();
    const lines = body.trim().split('\n');
    let imported = 0;

    for (const line of lines) {
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
        console.error("Failed to parse line:", line, lineError);
      }
    }

    return new Response(
      JSON.stringify({ message: `Imported ${imported} tweets` }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to import tweets" }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function exportTweets(): Promise<Response> {
  try {
    const tweets: Tweet[] = [];
    const iter = kv.list({ prefix: ["tweets"] });
    
    for await (const entry of iter) {
      tweets.push(entry.value as Tweet);
    }

    // Sort by timestamp
    tweets.sort((a, b) => a.timestamp - b.timestamp);

    // Convert to NDJSON
    const ndjson = tweets.map(tweet => JSON.stringify(tweet)).join('\n');

    return new Response(
      ndjson,
      { 
        headers: { 
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": "attachment; filename=tweets.ndjson"
        } 
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to export tweets" }),
      { status: STATUS_CODE.InternalServerError, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getImage(request: Request, tweetId: string): Promise<Response> {
  try {
    const tweetEntry = await kv.get(["tweets", tweetId]);
    if (!tweetEntry.value) {
      return new Response("Tweet not found", { status: STATUS_CODE.NotFound });
    }

    const tweet = tweetEntry.value as Tweet;
    if (!tweet.imageData || !tweet.imageType) {
      return new Response("Image not found", { status: STATUS_CODE.NotFound });
    }

    // Decode base64 image
    const imageBytes = Uint8Array.from(atob(tweet.imageData), c => c.charCodeAt(0));

    return new Response(
      imageBytes,
      { 
        headers: { 
          "Content-Type": tweet.imageType,
          "Cache-Control": "public, max-age=3600"
        } 
      }
    );
  } catch (error) {
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

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let response: Response;

  if (method === "POST" && path === "/api/tweets") {
    response = await createTweet(request);
  } else if (method === "GET" && path === "/api/tweets") {
    response = await getTweets();
  } else if (method === "POST" && path === "/api/reactions") {
    response = await addReaction(request);
  } else if (method === "GET" && path === "/api/reactions") {
    response = await getReactions();
  } else if (method === "POST" && path === "/api/import") {
    response = await importTweets(request);
  } else if (method === "GET" && path === "/api/export") {
    response = await exportTweets();
  } else if (method === "GET" && path.startsWith("/api/images/")) {
    const tweetId = path.split("/").pop();
    if (tweetId) {
      response = await getImage(request, tweetId);
    } else {
      response = new Response("Invalid image path", { status: STATUS_CODE.BadRequest });
    }
  } else {
    response = new Response("Not Found", { status: STATUS_CODE.NotFound });
  }

  // Add CORS headers to response
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

// Start server
console.log("🚀 Twitter-like API server starting...");
console.log("📚 Available endpoints:");
console.log("  POST /api/tweets - Create a new tweet (multipart/form-data)");
console.log("  GET  /api/tweets - Get all tweets");
console.log("  POST /api/reactions - Add reaction to tweet");
console.log("  GET  /api/reactions - Get available reactions");
console.log("  POST /api/import - Import tweets from NDJSON");
console.log("  GET  /api/export - Export tweets as NDJSON");
console.log("  GET  /api/images/:tweetId - Get tweet image");

await serve(handleRequest, { port: 8000 });
