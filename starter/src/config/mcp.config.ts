/**
 * Model Context Protocol (MCP) server configurations
 *
 * Both servers run locally over stdio. Tools they expose are named
 * mcp__<server>__<tool> (e.g. mcp__github__get_file_contents).
 *
 * Tool allowlisting happens in orchestrator.ts, not here: this file only
 * says HOW to start each server. Keep the two concerns separate.
 */
export const mcpServersConfig = {
  /** GitHub MCP: PR metadata, file contents, code search. Token is optional for public repos. */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '' }
  },

  /** ESLint MCP: lint-files. Only works on absolute local paths. */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
};
