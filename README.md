# AI Job + Research Chat (Cloudflare Agents)

This project is a minimal chat app built on Cloudflare's `agents-starter` template.

It keeps the starter architecture and UI, and adds two server-side capabilities:

1. Job finder
2. Research assistant (OpenAlex)

The app stays a single text-chat interface. The assistant decides when to call tools automatically.

### Deployed URL
- https://cf-ai.qayshawwar.workers.dev

## Local Setup is mentioned below

## What It Does

- Uses Workers AI (`@cf/zai-org/glm-4.7-flash`) for chat responses.
- Uses two built-in server tools:
  - `findJobs`: searches public job boards (Greenhouse + Ashby).
  - `searchResearch`: searches OpenAlex for academic works.
- Keeps conversation memory per conversation only (Durable Object chat state), with no long-term user memory.

## Supported Capabilities

### 1) Job Finder

The assistant can find relevant jobs from public boards based on query/title/keywords and optional location/company/employment type.

Each result includes (when available):
- title
- company
- location
- source
- link

### Job finder prompts

- `Find Software engineer positions at Ramp`
- `Look for internship roles at OpenAI`
- `Show me positions at Notion`
- `Positions a SpaceX`

The assistant should still respond conversationally even when no tool is needed.
### 2) Research Assistant

The assistant can search OpenAlex for scholarly works and return concise structured results.

Each result includes (when available):
- title
- authors
- year
- source/venue
- URL
- short summary snippet

### Research prompts

- `Find papers on retrieval-augmented generation`
- `Look for papers related to the biology of blue whales` 
- `Show recent work on diffusion models for time series`

### General chat prompt (outside tools)

- `Can you help me plan my study schedule this week?`

## Architecture (High Level)

- `src/app.tsx`: existing single-page React chat UI (minimal prompt updates only)
- `src/server.ts`: `AIChatAgent` Durable Object with:
  - Workers AI model
  - system prompt/instructions
  - `findJobs` tool
  - `searchResearch` tool
- `wrangler.jsonc`: Worker, Durable Object, and AI binding config

No auth, no separate database, no additional pages, no voice.

## Environment Variables

Only variable used:

- `OPENALEX_API_KEY` (optional)

If missing, OpenAlex still works in unauthenticated mode with stricter limits.

### Local `.dev.vars` example

```bash
OPENALEX_API_KEY=your_openalex_key_here
```

### Production secret example

```bash
npx wrangler secret put OPENALEX_API_KEY
```


### Local 

## Setup

```bash
npm install
```

(Optional) add `.dev.vars` with `OPENALEX_API_KEY`.

## Run Locally

```bash
npm run dev
```

Then open:

- `http://localhost:5173`



## Error Handling Behavior

- If a job source request fails, the tool reports partial/fallback output and source errors.
- If OpenAlex fails, the tool returns a graceful failure message.
- If no matches are found, the assistant gets a friendly no-results response to relay.

## Known Limitations

- Job search is demo-focused and not exhaustive.
- Public job board endpoints can change or temporarily fail.
- Company-specific searches may work best with recognizable company/board slugs.
- OpenAlex coverage depends on its indexed data.
- Memory is per conversation only; no long-term memory layer is implemented.

## Deploy

```bash
npm run deploy
```

## Notes

- This keeps Workers + Durable Object conversation state from the starter template.
- Workers AI remains the default LLM path from the starter.
