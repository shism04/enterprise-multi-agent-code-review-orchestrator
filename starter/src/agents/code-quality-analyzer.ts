import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts';

/** Security, performance and maintainability review of one file. Read-only. */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Reviews ONE changed source file for security vulnerabilities, performance problems, maintainability and bug risks. Use for every changed source file that contains logic.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  // Least privilege: Skill to load checklists, read the file, optionally lint it.
  tools: ['Skill', 'mcp__github__get_file_contents', 'mcp__eslint__lint-files'],
  model: 'inherit'
};
