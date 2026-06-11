#!/usr/bin/env node
/**
 * docforge MCP Server
 * ==================
 * Post-refactor MCP surface. Two tools:
 *
 *   - create_project   : Capture a new project (intake)
 *   - generate_document : Generate a document for an existing project
 *
 * The old 20-tool SourcePilot pipeline is gone. This is the whole
 * product. Transport: stdio (one JSON-RPC message per line).
 * Run with:  npm run mcp
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { env } from '../config/env';
import { ProjectModel } from '../models/ProjectModel';
import { DocumentOrchestrator } from '../services/DocumentOrchestrator';

// ---- Tool input schemas (Zod-validated at the MCP boundary) ----
const CreateProjectInput = z.object({
  name: z.string().min(1).max(200).describe('Project / engagement name.'),
  client_name: z.string().max(200).optional().describe('Optional client name.'),
  audience: z.enum(['non_tecnico', 'tecnico']).describe(
    'non_tecnico = Airtable-style proposal. ' +
      'tecnico = Orbit-style technical scope document.',
  ),
  project_type: z.string().max(100).optional().describe(
    'e.g. "web", "mobile", "api", "internal-tool".',
  ),
  raw_requirement: z.string().min(10).max(20_000).describe(
    'The client\'s verbatim request (1-2 paragraphs minimum).',
  ),
});

const GenerateDocumentInput = z.object({
  project_id: z.string().uuid().describe('The project UUID.'),
  doc_type: z.enum(['proposal', 'tech_scope']).describe(
    'Which template to generate. proposal = Airtable-style. ' +
      'tech_scope = Orbit-style.',
  ),
});

// ---- Tool definitions for the MCP client ----
const TOOLS = [
  {
    name: 'create_project',
    description:
      'Capture a new client project (intake). Returns the project row ' +
      'with its UUID. Use this first; then call generate_document ' +
      'with that UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project / engagement name.' },
        client_name: { type: 'string', description: 'Optional client name.' },
        audience: {
          type: 'string',
          enum: ['non_tecnico', 'tecnico'],
          description:
            'non_tecnico = Airtable-style proposal. ' +
            'tecnico = Orbit-style technical scope document.',
        },
        project_type: { type: 'string', description: 'e.g. web, mobile, api.' },
        raw_requirement: {
          type: 'string',
          description: 'The client\'s verbatim request (1-2 paragraphs min).',
        },
      },
      required: ['name', 'audience', 'raw_requirement'],
    },
  },
  {
    name: 'generate_document',
    description:
      'Generate a document (proposal or tech_scope) for an existing ' +
      'project. Returns the saved document row with the full markdown ' +
      'content in `content_markdown`.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project UUID.' },
        doc_type: {
          type: 'string',
          enum: ['proposal', 'tech_scope'],
          description: 'Which template to generate.',
        },
      },
      required: ['project_id', 'doc_type'],
    },
  },
] as const;

// ---- Server itself ----
const server = new Server(
  {
    name: 'docforge-mcp',
    version: '0.2.0',
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_project': {
        const input = CreateProjectInput.parse(args);
        const project = await ProjectModel.create(input);
        return textResult(JSON.stringify({ project }, null, 2));
      }

      case 'generate_document': {
        const { project_id, doc_type } = GenerateDocumentInput.parse(args);
        const document = await new DocumentOrchestrator().generate(
          project_id,
          doc_type as 'proposal' | 'tech_scope',
        );
        return textResult(JSON.stringify({ document }, null, 2));
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Tool "${name}" failed: ${message}`);
  }
});

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

// ---- Boot ----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error(
    `[docforge-mcp] running on stdio (model=${env.DEEPSEEK_MODEL}, supabase=${env.SUPABASE_URL})`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[docforge-mcp] fatal:', err);
  process.exit(1);
});
