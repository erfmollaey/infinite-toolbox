import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { projectDoctor } from './tools/project-doctor/index.js';
import { gitContext } from './tools/git-context/index.js';
import { environmentInspector } from './tools/environment-inspector/index.js';
import { dependencyInspector } from './tools/dependency-inspector/index.js';
import { logger } from './utils/logger.js';



interface ToolHandlerResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface MCPToolDef {
  tool: Tool;
  handler: (args: Record<string, unknown>) => Promise<ToolHandlerResult>;
}

function createMCPTool(
  name: string,
  description: string,
  jsonSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  },
  handler: (args: Record<string, unknown>) => Promise<unknown>
): MCPToolDef {
  return {
    tool: {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: (jsonSchema.properties || {}) as { [x: string]: object },
        required: jsonSchema.required
      }
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const result = await handler(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(`Tool '${name}' failed: ${errorMessage}`);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMessage }, null, 2) }],
          isError: true
        };
      }
    }
  };
}

const WorkspaceRootSchema = z.object({
  workspace_root: z.string().max(4096).optional().default('.')
});

function registerTools(server: Server): void {
  const tools: MCPToolDef[] = [
    createMCPTool(
      'infinity_project_doctor',
      'Analyze the structure and health of a local development project.',
      {
        type: 'object',
        properties: {
          workspace_root: { type: 'string', description: 'Path to the project workspace', maxLength: 4096 }
        },
        required: []
      },
      async (args) => {
        const parsed = WorkspaceRootSchema.safeParse(args ?? {});
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error.message}`);
        }
        return projectDoctor({ workspaceRoot: parsed.data.workspace_root });
      }
    ),
    createMCPTool(
      'infinity_git_context',
      'Provide structured information about the current Git working tree. All operations are read-only.',
      {
        type: 'object',
        properties: {
          workspace_root: { type: 'string', description: 'Path to the Git repository workspace', maxLength: 4096 }
        },
        required: []
      },
      async (args) => {
        const parsed = WorkspaceRootSchema.safeParse(args ?? {});
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error.message}`);
        }
        return gitContext({ workspaceRoot: parsed.data.workspace_root });
      }
    ),
    createMCPTool(
      'infinity_environment_inspector',
      'Inspect environment configuration without exposing secrets. Never returns variable values.',
      {
        type: 'object',
        properties: {
          workspace_root: { type: 'string', description: 'Path to the project workspace', maxLength: 4096 }
        },
        required: []
      },
      async (args) => {
        const parsed = WorkspaceRootSchema.safeParse(args ?? {});
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error.message}`);
        }
        return environmentInspector({ workspaceRoot: parsed.data.workspace_root });
      }
    ),
    createMCPTool(
      'infinity_dependency_inspector',
      'Analyze project dependencies and identify potential maintenance issues. Read-only; never installs or updates packages.',
      {
        type: 'object',
        properties: {
          workspace_root: { type: 'string', description: 'Path to the project workspace', maxLength: 4096 }
        },
        required: []
      },
      async (args) => {
        const parsed = WorkspaceRootSchema.safeParse(args ?? {});
        if (!parsed.success) {
          throw new Error(`Invalid arguments: ${parsed.error.message}`);
        }
        return dependencyInspector({ workspaceRoot: parsed.data.workspace_root });
      }
    )
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => t.tool)
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.tool.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    logger.info(`Tool called: ${name}`, { args: args ? JSON.stringify(args).substring(0, 200) : 'none' });
    return tool.handler(args ?? {}) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  });
}

export async function startServer(): Promise<void> {
  const server = new Server(
    {
      name: 'infinity-mcp-toolbox',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Infinity MCP Toolbox server started successfully');
}
