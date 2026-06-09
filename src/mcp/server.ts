#!/usr/bin/env node
/**
 * SourcePilot MCP Server
 * ======================
 * Exposes tools to MCP-compatible clients (Claude Desktop, Claude Code, etc.).
 *
 * Spec-stage tools (kept from the original MVP):
 *   - create_spec  : Generate a spec from an idea (calls DeepSeek + saves to Supabase)
 *   - save_spec    : Save an already-generated spec to Supabase
 *   - get_spec     : Retrieve the latest spec for a project by name
 *   - list_specs   : List every saved spec, newest first
 *
 * SourcePilot intake tools (new):
 *   - create_intake        : Open a new project with structured intake data
 *   - get_intake           : Retrieve the latest intake for a project
 *   - get_completeness     : Get a project's completeness score
 *   - get_lineage          : Get the version-graph lineage for a project
 *
 * All write paths go through ProjectOrchestrator (Constitution Article II).
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
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

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

const CreateIntakeInput = z.object({
  projectName: z.string().min(1).describe('Unique project name.'),
  projectDescription: z.string().optional().describe('Optional one-sentence project description.'),
  projectType: z.enum(['web', 'mobile', 'saas', 'internal', 'api', 'other']).optional()
    .describe('Project type.'),
  engagement: z.enum(['fixed_price', 'hourly']).optional()
    .describe('Engagement model.'),
  timelinePref: z.enum(['1-2w', '1m', '2-3m', '3-6m', 'flexible']).optional()
    .describe('Desired timeline.'),
  requirement: z.string().min(10).describe('The full client requirement / job details.'),
  details: z.string().optional().describe('Optional additional notes.'),
  constraints: z.string().optional().describe('Optional constraints.'),
});

const GetIntakeInput = z.object({
  projectId: z.string().uuid().describe('The project UUID.'),
});

const GetCompletenessInput = z.object({
  projectId: z.string().uuid().describe('The project UUID.'),
});

const GetLineageInput = z.object({
  projectId: z.string().uuid().describe('The project UUID.'),
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

  // ---- SourcePilot tools ----
  {
    name: 'create_intake',
    description:
      'SourcePilot: open a new project with structured intake data (project type, engagement, timeline, requirement, etc.). Returns the project, intake row, and current completeness score.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'Unique project name.' },
        projectDescription: { type: 'string', description: 'Optional one-sentence project description.' },
        projectType: {
          type: 'string',
          enum: ['web', 'mobile', 'saas', 'internal', 'api', 'other'],
          description: 'Project type.',
        },
        engagement: {
          type: 'string',
          enum: ['fixed_price', 'hourly'],
          description: 'Engagement model.',
        },
        timelinePref: {
          type: 'string',
          enum: ['1-2w', '1m', '2-3m', '3-6m', 'flexible'],
          description: 'Desired timeline.',
        },
        requirement: { type: 'string', description: 'The full client requirement / job details (min 10 chars).' },
        details: { type: 'string', description: 'Optional additional notes.' },
        constraints: { type: 'string', description: 'Optional constraints.' },
      },
      required: ['projectName', 'requirement'],
    },
  },
  {
    name: 'get_intake',
    description: 'SourcePilot: get the latest intake row for a project (by project UUID).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project UUID.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_completeness',
    description: 'SourcePilot: get a project\'s completeness score (0-100) and list of missing items.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project UUID.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_lineage',
    description: 'SourcePilot: get the version-graph lineage for a project (all stages with latest versions).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project UUID.' },
      },
      required: ['projectId'],
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

      // ---- SourcePilot tools ----
      case 'create_intake': {
        const input = CreateIntakeInput.parse(args);
        const orchestrator = new ProjectOrchestrator();
        const { project, intake } = await orchestrator.createIntake(input);
        const completeness = await orchestrator.getCompleteness(project.id);
        return textResult(JSON.stringify({ project, intake, completeness }, null, 2));
      }

      case 'get_intake': {
        const { projectId } = GetIntakeInput.parse(args);
        const intake = await new ProjectOrchestrator().getLatestIntake(projectId);
        if (!intake) {
          return textResult(`No intake found for project ${projectId}.`);
        }
        return textResult(JSON.stringify(intake, null, 2));
      }

      case 'get_completeness': {
        const { projectId } = GetCompletenessInput.parse(args);
        const result = await new ProjectOrchestrator().getCompleteness(projectId);
        return textResult(JSON.stringify(result, null, 2));
      }

      case 'get_lineage': {
        const { projectId } = GetLineageInput.parse(args);
        const lineage = await new ProjectOrchestrator().getLineage(projectId);
        return textResult(JSON.stringify({ projectId, lineage }, null, 2));
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
    `[sourcepilot-mcp] running on stdio (model=${env.DEEPSEEK_MODEL}, supabase=${env.SUPABASE_URL})`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[ai-software-planning-assistant-mcp] fatal:', err);
  process.exit(1);
});
