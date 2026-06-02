# Focuslane API

Cloudflare Worker backend for Focuslane's AI-powered YouTube video filtering.

The service accepts a batch of video metadata plus a user-defined filter rule, sends the decision task to Groq's OpenAI-compatible chat completions API, and returns a per-video decision map where `true` means show the video and `false` means hide it.

## Features

- Serverless Cloudflare Worker API.
- Single classification endpoint for batched video metadata filtering.
- Groq-hosted model integration using `openai/gpt-oss-120b`.
- Strict JSON-schema AI output parsing.
- CORS support for browser extension clients.
- Cloudflare Workers observability, logs, and traces enabled in `wrangler.toml`.
- GitHub Actions deployment on pushes to `main`.

## Project Structure

```text
.
|-- .github/workflows/deploy.yml  # Deploys the Worker from GitHub Actions
|-- src/index.js                  # Worker entrypoint and API implementation
|-- package.json                  # npm scripts and Wrangler dependency
|-- wrangler.toml                 # Cloudflare Worker configuration
`-- README.md                     # Project documentation
```

## Requirements

- Node.js and npm.
- A Cloudflare account with Workers enabled.
- A Groq API key.
- Wrangler, installed through the project dependency.

## Setup

Install dependencies:

```bash
npm install
```

For local development, create a `.dev.vars` file in the project root:

```ini
GROQ_API_KEY=your_groq_api_key
```

`.dev.vars` is ignored by git and should not be committed.

For deployed environments, store the Groq key as a Cloudflare Worker secret:

```bash
npx wrangler secret put GROQ_API_KEY
```

## Development

Start the local Worker:

```bash
npm run dev
```

Wrangler usually serves the Worker at:

```text
http://127.0.0.1:8787
```

## Deployment

Deploy manually:

```bash
npm run deploy
```

The repository also includes `.github/workflows/deploy.yml`, which deploys automatically on pushes to `main`.

The GitHub Actions deployment expects these repository secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token with permission to deploy Workers. |
| `GROQ_API_KEY` | Groq API key passed to Wrangler as a Worker secret. |

## API

### `POST /api/classify`

Classifies video metadata against a user-defined filter rule.

#### Request Headers

```http
Content-Type: application/json
```

#### Request Body

```json
{
  "titles": [
    {
      "id": "video_id_1",
      "title": "Build a React dashboard from scratch",
      "channel": "Code Workshop",
      "description": "Step-by-step React tutorial using charts and API data."
    },
    {
      "id": "video_id_2",
      "title": "Celebrity gossip highlights",
      "channel": "Daily Celeb",
      "description": "Entertainment news and viral moments."
    }
  ],
  "filterRule": "Only show programming tutorials",
  "preferenceProfile": {
    "hideConfidenceThreshold": 0.8,
    "examples": [
      {
        "action": "show",
        "title": "System design interview deep dive",
        "channel": "Code Workshop",
        "reason": "User marked this as a false positive."
      }
    ]
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `titles` | array | Yes | List of videos to classify. Must contain 1 to 50 items. |
| `titles[].id` | string | Yes | Caller-provided video identifier. Used as the response key. |
| `titles[].title` | string | Yes | Video title to evaluate against the filter rule. |
| `titles[].channel` | string | No | Channel name to evaluate against the filter rule. |
| `titles[].description` | string | No | Visible video description or snippet to evaluate against the filter rule. |
| `filterRule` | string | Yes | Natural-language rule describing which videos to show or hide. |
| `preferenceProfile` | object | No | User-specific threshold and feedback examples used to personalize decisions without per-user fine tuning. |

#### Request Limits

- `titles` must include at least 1 item.
- Maximum `titles` length is 50.
- Each `id` must be a string.
- Each `title` must be a string.
- `channel` and `description` are optional, but must be strings when provided.
- `filterRule` must be a non-empty string.

Before the request is sent to Groq, the Worker trims the rule and limits the AI prompt input:

| Value | Limit |
| --- | --- |
| `filterRule` | First 500 characters |
| `titles[].id` | First 20 characters |
| `titles[].title` | First 200 characters |
| `titles[].channel` | First 120 characters |
| `titles[].description` | First 600 characters |
| `preferenceProfile.examples` | First 8 examples |

Keep IDs unique after the 20-character limit so response keys do not collide.

#### Success Response

```json
{
  "results": {
    "video_id_1": true,
    "video_id_2": false
  },
  "decisions": {
    "video_id_1": {
      "show": true,
      "confidence": 0.92,
      "reason": "Title and description clearly indicate a React tutorial."
    },
    "video_id_2": {
      "show": false,
      "confidence": 0.86,
      "reason": "Title and channel indicate celebrity entertainment."
    }
  },
  "error": null
}
```

| Field | Type | Description |
| --- | --- | --- |
| `results` | object | Map of video ID to decision. `true` means show, `false` means hide. |
| `decisions` | object | Map of video ID to `show`, `confidence`, and short evidence-based `reason`. |
| `error` | string or null | `null` on success. Contains an error code when classification fails. |

#### Example cURL

```bash
curl -X POST http://127.0.0.1:8787/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "titles": [
      {
        "id": "react-dashboard",
        "title": "Build a React dashboard from scratch",
        "channel": "Code Workshop",
        "description": "Step-by-step React tutorial using charts and API data."
      },
      {
        "id": "gossip-news",
        "title": "Celebrity gossip highlights",
        "channel": "Daily Celeb",
        "description": "Entertainment news and viral moments."
      }
    ],
    "filterRule": "Only show programming tutorials",
    "preferenceProfile": {
      "hideConfidenceThreshold": 0.8,
      "examples": [
        {
          "action": "show",
          "title": "System design interview deep dive",
          "channel": "Code Workshop",
          "reason": "User marked this as a false positive."
        }
      ]
    }
  }'
```

## Filtering Behavior

The Worker instructs the AI model to act as a careful YouTube video filter:

- If the rule says `only show X`, clear matches for `X` are shown, and videos are hidden only when metadata clearly fails the allowed scope.
- If the rule says `hide X` or `remove X`, videos are hidden only when metadata clearly matches `X`.
- If the rule has multiple conditions, a video must satisfy all show conditions and no hide conditions.
- Ambiguous videos are shown with low confidence to reduce false positives.
- Video title, channel, and description are treated as data, not instructions.
- User feedback examples can personalize future decisions.
- The model can only return IDs from the submitted request.

## Error Responses

Some validation errors return only an `error` field. Classification and upstream errors return `results` when possible.

| Status | Error | Cause |
| --- | --- | --- |
| `204` | none | CORS preflight request. |
| `400` | `Invalid JSON body` | Request body could not be parsed as JSON. |
| `400` | `titles array is required` | `titles` is missing, empty, or not an array. |
| `400` | `filterRule string is required` | `filterRule` is missing, empty, or not a string. |
| `400` | `Maximum 50 titles per request` | More than 50 titles were submitted. |
| `400` | `Each title must have id and title strings; channel and description must be strings when provided` | A title item is malformed. |
| `404` | `Not found` | POST request path is not supported. |
| `405` | `Method not allowed` | Request method is not `POST` or `OPTIONS`. |
| `429` | `rate_limited` | Groq returned a rate-limit response. |
| `500` | `service_misconfigured` | `GROQ_API_KEY` is not configured. |
| `502` | `auth_error` | Groq rejected the configured API key. |
| `502` | `upstream_<status>` | Groq returned another non-success status. |
| `502` | `empty_response` | Groq returned no message content. |
| `502` | `invalid_response` | Groq returned content that could not be parsed as JSON. |
| `502` | `api_error` | Network or runtime error while calling Groq. |

## CORS

Responses include:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

The `OPTIONS` preflight response also includes:

```http
Access-Control-Max-Age: 86400
```

## Configuration Notes

`wrangler.toml` defines the Worker name, entrypoint, compatibility date, observability settings, and a currently configured `ALLOWED_ORIGIN` variable:

```toml
name = "focuslane-api"
main = "src/index.js"
compatibility_date = "2024-12-01"
```

The current implementation returns wildcard CORS headers directly from `src/index.js`.

## Troubleshooting

### `service_misconfigured`

The Worker cannot find `GROQ_API_KEY`.

- For local development, add it to `.dev.vars`.
- For deployed Workers, run `npx wrangler secret put GROQ_API_KEY`.
- For GitHub Actions deployment, add `GROQ_API_KEY` to repository secrets.

### `auth_error`

The Groq key is missing, invalid, expired, or does not have permission to call the configured model.

### `rate_limited`

Groq returned a rate-limit response. Retry later or reduce request frequency.

### Too Many Videos Are Hidden

Raise `preferenceProfile.hideConfidenceThreshold`, add user feedback examples, or make the `filterRule` more explicit. Ambiguous videos are shown by default, so repeated false positives usually mean the rule or examples are too broad.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the local Worker with Wrangler. |
| `npm run deploy` | Deploy the Worker to Cloudflare. |
