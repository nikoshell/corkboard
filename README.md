# Cork Board API Usage Guide

## Setup and Deployment

### Local Development
```bash
# Run locally
deno run --allow-net --allow-env --allow-read --allow-write main.ts

# Run with auto-reload
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

### 5. Import Tweets
**POST** `/api/import`

**Content-Type:** `text/plain`

Upload an NDJSON file with tweets. Each line should be a valid JSON object.

**Example:**
```bash
curl -X POST http://localhost:8000/api/import \
  -H "Content-Type: text/plain" \
  --data-binary @tweets.ndjson
```

### 6. Export Tweets
**GET** `/api/export`

Downloads all tweets as an NDJSON file.

**Example:**
```bash
curl http://localhost:8000/api/export -o exported-tweets.ndjson
```

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
