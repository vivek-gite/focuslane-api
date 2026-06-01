# focuslane-api (Cloudflare Worker)

Backend service for focuslane's AI video filtering.

## Setup

```bash
npm install
```

## Configure the Groq API key as a secret

```bash
npx wrangler secret put GROQ_API_KEY
```

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

## API

### POST /api/classify

Classifies video titles against a user-defined filter rule.

**Request body:**
```json
{
  "titles": [
    { "id": "video_id_1", "title": "Video Title 1" },
    { "id": "video_id_2", "title": "Video Title 2" }
  ],
  "filterRule": "Only show programming tutorials"
}
```

**Response:**
```json
{
  "results": {
    "video_id_1": true,
    "video_id_2": false
  },
  "error": null
}
```

- `results`: Map of video ID → boolean (true = show, false = hide)
- `error`: null on success, string error code on failure

**Limits:** Max 50 titles per request.
