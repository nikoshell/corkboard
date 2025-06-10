# Corkboard API Usage Guide

## Setup and Deployment

### Local Development
```bash
# Run locally
export ADMIN_TOKEN=${{ secrets.ADMIN_TOKEN }}
deno run --allow-net --allow-env --allow-read --allow-write main.ts

# Run with auto-reload
export ADMIN_TOKEN=${{ secrets.ADMIN_TOKEN }}
deno run --allow-net --allow-env --allow-read --allow-write --watch main.ts
```

### Deno Deploy Setup
1. Create a new project on [Deno Deploy](https://dash.deno.com)
2. Connect your GitHub repository
3. Update `.github/workflows/deploy.yml` with your project name
4. Push to the main branch to trigger deployment

## API Endpoints

### 1. Create Tweet
**POST** `/api/tweets`

**Content-Type:** `multipart/form-data`

**Parameters:**
- `displayName` (required): User's display name
- `handle` (optional): Social media handle (e.g., "@username")
- `content` (required): Tweet content
- `image` (optional): Image file (will be resized and stored)

**Example using curl:**
```bash
curl -X POST http://localhost:8000/api/tweets \
  -F "displayName=John Doe" \
  -F "handle=@johndoe" \
  -F "content=Hello world!" \
  -F "image=@./my-image.jpg"
```

### 2. Get All Tweets
**GET** `/api/tweets`

Returns all tweets sorted by timestamp (newest first).

**Example:**
```bash
curl http://localhost:8000/api/tweets
```

### 3. Add Reaction
**POST** `/api/reactions`

**Content-Type:** `application/json`

**Body:**
```json
{
  "tweetId": "tweet-id-here",
  "reaction": "👍"
}
```

**Available reactions:** 👍, ❤️, 😂, 😮, 😢, 😡, 🔥, 🚀, 👏, 🎉

**Example:**
```bash
curl -X POST http://localhost:8000/api/reactions \
  -H "Content-Type: application/json" \
  -d '{"tweetId":"some-tweet-id","reaction":"❤️"}'
```

### 4. Get Available Reactions
**GET** `/api/reactions`

Returns list of available reaction emojis.

# Delete a specific note
curl -X DELETE "https://your-deno-deploy-url.deno.dev/api/notes" \
  -H "Authorization: Bearer your-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"noteId": "note-id-to-delete"}'

# Delete all notes
curl -X DELETE "https://your-deno-deploy-url.deno.dev/api/notes" \
  -H "X-Admin-Token: your-admin-token"


curl -X POST "https://your-server.deno.dev/api/import" \
  -H "Authorization: Bearer your-admin-token" \
  -H "Content-Type: text/plain" \
  --data-binary @notes.ndjson

curl -X GET "https://your-server.deno.dev/api/export" \
  -H "X-Admin-Token: your-admin-token" \
  -o exported-notes.ndjson

### 7. Get Tweet Image
**GET** `/api/images/:tweetId`

Returns the image associated with a tweet (if any).

**Example:**
```bash
curl http://localhost:8000/api/images/some-tweet-id -o tweet-image.jpg
```

## Data Structure

### Tweet Object
```json
{
  "id": "unique-tweet-id",
  "displayName": "User Name",
  "handle": "@username",
  "content": "Tweet content here",
  "imageData": "base64-encoded-image-data",
  "imageType": "image/jpeg",
  "timestamp": 1672531200000,
  "reactions": {
    "👍": 5,
    "❤️": 12,
    "😂": 2,
    "😮": 0,
    "😢": 0,
    "😡": 0,
    "🔥": 8,
    "🚀": 15,
    "👏": 3,
    "🎉": 7
  }
}
```

## Features

- ✅ Create tweets with text and images
- ✅ Display name and optional social handle
- ✅ 10 different reaction types with counters
- ✅ Image storage in Deno KV (base64 encoded)
- ✅ NDJSON import/export functionality
- ✅ No authentication required
- ✅ CORS enabled for web frontend integration
- ✅ Automatic deployment with GitHub Actions

## Image Handling

- Images are automatically converted to base64 and stored in KV
- Target resolution mentioned (350x200) - you may want to add actual resizing logic
- Supported formats: Any image type supported by browsers
- Images are served with proper MIME types and caching headers

## Deployment Notes

- The app uses Deno KV which is automatically available on Deno Deploy
- No external database setup required
- Environment variables can be set in Deno Deploy dashboard if needed
- The API is stateless and can handle multiple instances

## CORS Support

The API includes CORS headers to allow frontend applications to interact with it from different domains.
