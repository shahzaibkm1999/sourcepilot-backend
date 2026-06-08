#!/usr/bin/env node
/**
 * AI Software Planning Assistant MCP Server
 * ========================================
 * Exposes four tools to MCP-compatible clients (Claude Desktop, Claude Code, etc.):
 *
 *   - create_spec  : Generate a spec from an idea (calls Gemini + saves to Supabase)
 *   - save_spec    : Save an already-generated spec to Supabase
 *   - get_spec     : Retrieve the latest spec for a project by name
 *   - list_specs   : List every saved spec, newest first
 *
 * Transport: stdio (one JSON-RPC message per line, per the MCP spec).
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
import { SupabaseService } from '../services/SupabaseService';
import { SpecificationGenerator } from '../services/SpecificationGenerator';

// ---- Tool input schemas (validated with zod) ----
const CreateSpecInput = z.object({
  projectIdea: z.string().min(3).describe('A one-line description of the project idea.'),
});

const SaveSpecInput = z.object({
  projectName: z.string().min(1).describe('Unique project name (used as the key in the projects table).'),
  projectDescription: z.string().optional().describe('Optional one-sentence description of the project.'),
  specificationContent: z
    .string()
    .min(10)
    .describe('The full Markdown specification content to save.'),
});

const GetSpecInput = z.object({
  projectName: z.string().min(1).describe('The project name whose spec you want to retrieve.'),
});

// ---- Tool definitions for the MCP client ----
const TOOLS = [
  {
    name: 'create_spec',
    description:
      'Generate a full software specification from a one-line project idea using Google Gemini, then save it to Supabase. Returns the saved spec.',
    inputSchema: {
      type: 'object',
      properties: {
        projectIdea: {
          type: 'string',
          description: 'A one-line description of the project idea.',
        },
      },
      required: ['projectIdea'],
    },
  },
  {
    name: 'save_spec',
    description:
      'Save an already-generated specification to Supabase. Creates the project if it does not exist; otherwise inserts a new versioned row.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'Unique project name.' },
        projectDescription: { type: 'string', description: 'Optional project description.' },
        specificationContent: {
          type: 'string',
          description: 'Full Markdown specification content.',
        },
      },
      required: ['projectName', 'specificationContent'],
    },
  },
  {
    name: 'get_spec',
    description:
      'Retrieve the latest saved specification for a project, looked up by project name.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'The project name to look up.' },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'list_specs',
    description: 'List every saved specification, newest first, joined with project metadata.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
] as const;

// ---- The server itself ----
const server = new Server(
  {
    name: 'ai-software-planning-assistant-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_spec': {
        const { projectIdea } = CreateSpecInput.parse(args);
        const { saved } = await new SpecificationGenerator().createAndSave(projectIdea);
        return textResult(JSON.stringify(saved, null, 2));
      }

      case 'save_spec': {
        const { projectName, projectDescription, specificationContent } = SaveSpecInput.parse(args);
        const { project, specification } = await SupabaseService.saveSpec({
          projectName,
          projectDescription,
          content: specificationContent,
        });
        return textResult(
          JSON.stringify({ project, specification }, null, 2),
        );
      }

      case 'get_spec': {
        const { projectName } = GetSpecInput.parse(args);
        const spec = await SupabaseService.getSpec(projectName);
        if (!spec) {
          return textResult(`No specification found for project "${projectName}".`);
        }
        return textResult(JSON.stringify(spec, null, 2));
      }

      case 'list_specs': {
        const specs = await SupabaseService.listSpecs();
        return textResult(JSON.stringify(specs, null, 2));
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
  return {
    content: [{ type: 'text' as const, text }],
  };
}

function errorResult(text: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text }],
  };
}

// ---- Boot ----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so we never corrupt the JSON-RPC stream on stdout.
  // eslint-disable-next-line no-console
  console.error(
    `[ai-software-planning-assistant-mcp] running on stdio (model=${env.GEMINI_MODEL}, supabase=${env.SUPABASE_URL})`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[ai-software-planning-assistant-mcp] fatal:', err);
  process.exit(1);
});
