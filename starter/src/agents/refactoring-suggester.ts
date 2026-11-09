import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts';

/** Behavior-preserving refactorings with before/after code. Read-only. */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Suggests behavior-preserving refactorings (extract function, modernize, remove dead code) for ONE changed source file, with before/after code. Use for every changed source file.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Skill', 'mcp__github__get_file_contents'],
  model: 'inherit'
};
