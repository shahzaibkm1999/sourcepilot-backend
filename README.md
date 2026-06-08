# AI Software Planning Assistant Backend

Node.js + TypeScript + Express backend for the AI Powered Software Planning Assistant MVP.

* **MVC architecture** (`controllers/`, `models/`, `routes/`, `services/`)
* **Google Gemini** for spec generation
* **Supabase** for project + spec storage
* **MCP server** (`src/mcp/server.ts`) that exposes the same domain logic
  as four tools to any MCP-compatible client
* Input validation with **Zod**, typed errors, request logging, CORS

## Project layout

```
backend/
├── src/
│   ├── app.ts              # Express app factory (no listen)
│   ├── server.ts           # Local entry point (boots app.listen)
│   ├── config/             # env validation + Supabase client
│   ├── controllers/        # HTTP request handlers
│   ├── models/             # Supabase queries (typed)
│   ├── routes/             # Express routers
│   ├── services/           # Gemini + orchestration
│   ├── middleware/         # error handler, async wrapper
│   ├── mcp/                # MCP server (stdio transport)
│   ├── types/              # Shared domain types
│   └── utils/
├── supabase/
│   └── schema.sql          # Run once in Supabase SQL editor
├── package.json
├── tsconfig.json
└── .env.example
```

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and provide:

| Variable | Where to get it |
| --- | --- |
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> (free tier) |
| `GEMINI_MODEL` | Any Gemini text model. Default: `gemini-2.5-flash` |
| `SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase project → Settings → **API Keys** → API Keys tab → "Publishable key" (formerly called `anon` key; new format starts with `sb_publishable_…`) |
| `PORT` | (optional) defaults to `5000` |
| `CORS_ORIGIN` | Frontend origin, e.g. `http://localhost:5173` |

### 3. Create the Supabase schema

1. Create a new Supabase project.
2. Open the **SQL Editor** in the Supabase dashboard.
3. Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql) and run.
   This creates the `projects` and `specifications` tables, an index, and
   open RLS policies (suitable for the MVP — tighten before production).

### 4. Run

```bash
# Dev mode (auto-restart on file change)
npm run dev

# Or production build
npm run build
npm start
```

The API is at `http://localhost:5000` and exposes:

* `GET    /health`
* `GET    /api/projects`
* `GET    /api/projects/:name`
* `GET    /api/projects/:name/specifications`
* `GET    /api/specifications`
* `GET    /api/specifications/:id`
* `GET    /api/specifications/by-name/:name`
* `POST   /api/specifications/generate`  → `{ projectIdea: string }`
* `POST   /api/specifications/save`     → `{ projectName, specificationContent, projectDescription? }`

## MCP server

The same domain logic is exposed to MCP clients (Claude Desktop, Claude Code,
custom agents, …) through `src/mcp/server.ts`.

```bash
# Run the MCP server on stdio
npm run mcp
```

The four tools it advertises:

| Tool | Purpose |
| --- | --- |
| `create_spec` | Generate a spec with Gemini **and** save it |
| `save_spec`   | Save an already-generated spec |
| `get_spec`    | Retrieve the latest spec for a project name |
| `list_specs`  | List every saved spec, newest first |

To wire it into Claude Desktop, add an entry to
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-software-planning-assistant": {
      "command": "node",
      "args": ["/absolute/path/to/backend/dist/mcp/server.js"],
      "env": {
        "GEMINI_API_KEY": "...",
        "GEMINI_MODEL": "gemini-2.5-flash",
        "SUPABASE_URL": "...",
        "SUPABASE_PUBLISHABLE_KEY": "..."
      }
    }
  }
}
```

(For local dev you can swap `node` for `npx ts-node` and point at the `.ts`
source instead.)

## Development notes

* All env access goes through `src/config/env.ts` — there are no scattered
  `process.env.X` reads.
* Every Supabase call is wrapped in a typed model (`ProjectModel`,
  `SpecificationModel`). Controllers never call `supabase.from(...)` directly.
* The Gemini prompt (`src/services/GeminiService.ts`) asks the model to return
  a JSON header `{projectName, projectDescription}` followed by `---` and the
  full Markdown body. The parser tolerates malformed responses.
* Errors thrown in async handlers are caught by `errorHandler` middleware and
  returned as `{ error: string }`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the API with `ts-node-dev` (auto-restart) |
| `npm run build` | TypeScript → `dist/` |
| `npm start` | Run the built API |
| `npm run mcp` | Start the MCP server on stdio |
| `npm run mcp:dev` | Same, with `ts-node-dev` |
| `npm run typecheck` | TypeScript only, no emit |
