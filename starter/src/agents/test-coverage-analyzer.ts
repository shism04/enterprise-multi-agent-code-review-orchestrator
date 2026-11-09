import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts';

/** Finds untested functions/branches and suggests concrete tests. Read-only. */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Determines which functions and branches of ONE changed source file lack tests and proposes specific test cases. Use for every changed source file.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: ['Skill', 'mcp__github__get_file_contents', 'mcp__github__search_code'],
  model: 'inherit'
};
