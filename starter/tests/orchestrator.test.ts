import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace the SDK with a fake query() so tests never call the API
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { CodeReviewOrchestrator, readOnlyGuard } from '../src/orchestrator';
import { RateLimiter } from '../src/utils/rate-limiter';
import { ErrorCodes } from '../src/utils/error-handler';

const mockedQuery = vi.mocked(query);

/** A valid ReviewReport with deliberately wrong summary numbers (the code must fix them). */
function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    pullRequest: { owner: 'x', repo: 'y', number: 1 },
    fileReviews: [
      {
        file: 'src/a.ts',
        codeQuality: {
          file: 'src/a.ts',
          issues: [
            { line: 3, severity: 'critical', category: 'security', description: 'SQL concat', suggestion: 'use params' },
            { line: 9, severity: 'low', category: 'style', description: 'naming', suggestion: 'rename' }
          ],
          overallScore: 60,
          summary: 'risky'
        },
        testCoverage: {
          file: 'src/a.ts', hasTests: false, testFiles: [], coverageEstimate: 0, summary: 's',
          untestedPaths: [
            { type: 'function', location: 'f()', priority: 'critical', reasoning: 'r', suggestedTest: 't' },
            { type: 'branch', location: 'g()', priority: 'low', reasoning: 'r', suggestedTest: 't' }
          ]
        },
        refactorings: {
          file: 'src/a.ts',
          suggestions: [
            { type: 'simplify', location: 'h()', impact: 'low', description: 'd', before: 'b', after: 'a', benefits: 'x' }
          ],
          summary: 's'
        }
      },
      {
        file: 'src/b.ts',
        codeQuality: { file: 'src/b.ts', issues: [], overallScore: 100, summary: 'clean' },
        testCoverage: { file: 'src/b.ts', hasTests: true, testFiles: ['tests/b.test.ts'], coverageEstimate: 90, summary: 's', untestedPaths: [] },
        refactorings: { file: 'src/b.ts', suggestions: [], summary: 's' }
      }
    ],
    summary: { totalFiles: 99, overallScore: 1, criticalIssues: 99, highPriorityTests: 99, refactoringOpportunities: 99 },
    recommendations: [],
    metadata: { analyzedAt: 'old', duration: 0, agentVersions: { 'code-quality-analyzer': '1.0.0' } },
    ...overrides
  };
}

/** Build a fake query() that yields the given messages. Captures the options it received. */
function fakeRun(messages: unknown[]) {
  const seen: { options?: Record<string, unknown> } = {};
  mockedQuery.mockImplementation(((args: { options: Record<string, unknown> }) => {
    seen.options = args.options;
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }) as unknown as typeof query);
  return seen;
}

const dispatchAll = {
  type: 'assistant',
  message: {
    content: ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester'].map(name => ({
      type: 'tool_use', name: 'Task', input: { subagent_type: name }
    }))
  }
};
const success = (structured_output: unknown) => ({ type: 'result', subtype: 'success', structured_output });

describe('CodeReviewOrchestrator configuration', () => {
  it('registers all three subagents, Task, Skill and structured output', async () => {
    const seen = fakeRun([dispatchAll, success(makeReport())]);
    await new CodeReviewOrchestrator({ rateLimiter: new RateLimiter() }).reviewPullRequest('x', 'y', 1);

    const opts = seen.options!;
    expect(Object.keys(opts.agents as object).sort()).toEqual(
      ['code-quality-analyzer', 'refactoring-suggester', 'test-coverage-analyzer']
    );
    expect(opts.allowedTools).toEqual(expect.arrayContaining(['Task', 'Skill']));
    expect(opts.outputFormat).toMatchObject({ type: 'json_schema' });
    expect(opts.settingSources).toEqual(['project']);
    expect(Object.keys(opts.mcpServers as object)).toEqual(['github', 'eslint']);
  });

  it('gives every subagent model inherit and no write tools', async () => {
    const seen = fakeRun([success(makeReport())]);
    await new CodeReviewOrchestrator({ rateLimiter: new RateLimiter() }).reviewPullRequest('x', 'y', 1);

    for (const agent of Object.values(seen.options!.agents as Record<string, { model: string; tools: string[] }>)) {
      expect(agent.model).toBe('inherit');
      expect(agent.tools).not.toContain('Write');
      expect(agent.tools).not.toContain('Bash');
    }
  });
});

describe('CodeReviewOrchestrator results', () => {
  it('recomputes summary and metadata in code, ignoring the model numbers', async () => {
    fakeRun([dispatchAll, success(makeReport())]);
    const report = await new CodeReviewOrchestrator({ rateLimiter: new RateLimiter() }).reviewPullRequest('x', 'y', 1);

    expect(report.summary.totalFiles).toBe(2);
    expect(report.summary.overallScore).toBe(80);            // round((60 + 100) / 2)
    expect(report.summary.criticalIssues).toBe(1);
    expect(report.summary.highPriorityTests).toBe(1);        // only the critical untested path
    expect(report.summary.refactoringOpportunities).toBe(1);
    expect(report.pullRequest).toEqual({ owner: 'x', repo: 'y', number: 1 });
    expect(report.metadata.analyzedAt).not.toBe('old');
  });

  it('returns 0 overall score when there are no files', async () => {
    fakeRun([success(makeReport({ fileReviews: [] }))]);
    const report = await new CodeReviewOrchestrator({ rateLimiter: new RateLimiter() }).reviewPullRequest('x', 'y', 1);
    expect(report.summary.overallScore).toBe(0);
    expect(report.summary.totalFiles).toBe(0);
  });

  it('rejects output that fails Zod validation with STRUCTURED_OUTPUT_FAILED', async () => {
    fakeRun([success({ not: 'a report' })]);
    await expect(
      new CodeReviewOrchestrator({ rateLimiter: new RateLimiter(), maxAttempts: 1 }).reviewPullRequest('x', 'y', 1)
    ).rejects.toMatchObject({ code: ErrorCodes.STRUCTURED_OUTPUT_FAILED });
  });

  it('maps a budget-exhausted run to AGENT_FAILED', async () => {
    fakeRun([{ type: 'result', subtype: 'error_max_budget_usd' }]);
    await expect(
      new CodeReviewOrchestrator({ rateLimiter: new RateLimiter(), maxAttempts: 1 }).reviewPullRequest('x', 'y', 1)
    ).rejects.toMatchObject({ code: ErrorCodes.AGENT_FAILED });
  });
});

describe('readOnlyGuard hook', () => {
  const run = (tool_name: string) =>
    readOnlyGuard(
      { hook_event_name: 'PreToolUse', tool_name, tool_input: {}, tool_use_id: 'u', session_id: 's', transcript_path: '', cwd: '' } as never,
      undefined,
      { signal: new AbortController().signal }
    );

  it('denies write tools on GitHub', async () => {
    const out = await run('mcp__github__create_issue');
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  it('denies built-in write tools', async () => {
    const out = await run('Write');
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  it('allows read-only GitHub tools', async () => {
    const out = await run('mcp__github__get_file_contents');
    expect(out).toEqual({ continue: true });
  });
});

describe('Integration', () => {
  // Needs a real ANTHROPIC_API_KEY and network. Run manually: npm run dev -- udacity cd14715-simple-todo-app 1
  it.skip('reviews a real small PR', async () => {});
});
