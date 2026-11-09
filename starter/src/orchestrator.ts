import { query, type AgentDefinition, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReport, ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types';
import { buildOrchestratorPrompt } from './prompts';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents';
import { mcpServersConfig } from './config/mcp.config';
import { RateLimiter, withRateLimit } from './utils/rate-limiter';
import { ReviewError, ErrorCodes, withRetry, withTimeout, formatError, isReviewError } from './utils/error-handler';
import { logger, logReviewStart, logReviewComplete, logReviewError } from './utils/logger';


const READ_ONLY_GITHUB_TOOLS = new Set([
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__github__search_code'
]);
const ALLOWED_TOOLS = ['Task', 'Skill', 'mcp__eslint__lint-files', ...READ_ONLY_GITHUB_TOOLS];
const DISALLOWED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit'];
const EXPECTED_SUBAGENTS = ['code-quality-analyzer', 'test-coverage-analyzer', 'refactoring-suggester'];

/**
 * PreToolUse hook: deterministic permission wall.
 */
export const readOnlyGuard: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return { continue: true };

  const tool = input.tool_name;
  const isWriteGithub = tool.startsWith('mcp__github__') && !READ_ONLY_GITHUB_TOOLS.has(tool);

  if (isWriteGithub || DISALLOWED_TOOLS.includes(tool)) {
    logger.warn('Blocked tool call', { tool });
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Read-only review: this tool is not allowed'
      }
    };
  }
  return { continue: true };
};

export interface OrchestratorOptions {
  rateLimiter?: RateLimiter;
  timeoutMs?: number;
  maxAttempts?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxFiles?: number;
}

interface StreamMessage {
  type: string;
  subtype?: string;
  message?: { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> };
  structured_output?: unknown;
}

/**
 * Main Code Review Orchestrator.
 * Runs one SDK query that spawns the three subagents, validates the result
 * with Zod, and recomputes every summary number in code.
 */
export class CodeReviewOrchestrator {
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly maxTurns: number;
  private readonly maxBudgetUsd: number;
  private readonly maxFiles: number;

  constructor(options: OrchestratorOptions = {}) {
    this.limiter = options.rateLimiter ?? new RateLimiter({ maxRequestsPerMinute: 50, maxTokensPerMinute: 100_000, maxConcurrent: 5 });
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.maxTurns = options.maxTurns ?? 40;
    this.maxBudgetUsd = options.maxBudgetUsd ?? 5;
    this.maxFiles = options.maxFiles ?? 10;
  }


  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    const start = Date.now();
    logReviewStart(owner, repo, prNumber);

    try {
      const report = await withRateLimit(
        this.limiter,
        () =>
          withTimeout(
            (signal) =>
              withRetry(
                () => this.runOnce(owner, repo, prNumber, signal),
                this.maxAttempts,
                2000,
                signal,
                isRetryable
              ),
            this.timeoutMs,
            `Review of ${owner}/${repo}#${prNumber} timed out`
          ),
        50_000 // estimated tokens for a whole review
      );

      const final = this.recalculate(report, owner, repo, prNumber, Date.now() - start);
      logReviewComplete(owner, repo, prNumber, final.summary.overallScore, Date.now() - start);
      return final;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(formatError(error)));
      throw error;
    }
  }

  /** One SDK run. Throws ReviewError on any failure the caller should know about. */
  private async runOnce(owner: string, repo: string, prNumber: number, signal: AbortSignal): Promise<ReviewReport> {
    // Bridge the timeout signal into the SDK's own cancellation mechanism
    const abortController = new AbortController();
    signal.addEventListener('abort', () => abortController.abort(), { once: true });

    const prompt = buildOrchestratorPrompt({ owner, repo, prNumber, maxFiles: this.maxFiles });
    const agents: Record<string, AgentDefinition> = {
      'code-quality-analyzer': codeQualityAnalyzer,
      'test-coverage-analyzer': testCoverageAnalyzer,
      'refactoring-suggester': refactoringSuggester
    };

    const dispatched = new Set<string>();
    let structuredOutput: unknown;
    let cliStderr = '';

    try {
      for await (const raw of query({
        prompt,
        options: {
          model: process.env.ANTHROPIC_MODEL,
          cwd: process.env.PROJECT_ROOT,        
          settingSources: ['project'],
          mcpServers: mcpServersConfig,
          agents,
          allowedTools: ALLOWED_TOOLS,
          disallowedTools: DISALLOWED_TOOLS,
          hooks: { PreToolUse: [{ hooks: [readOnlyGuard] }] },
          outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema },
          maxTurns: this.maxTurns,
          maxBudgetUsd: this.maxBudgetUsd,
          abortController,
          stderr: (data: string) => { cliStderr = (cliStderr + data).slice(-4000); }
        }
      })) {
        const message = raw as unknown as StreamMessage;

        if (message.type === 'assistant') {
          for (const block of message.message?.content ?? []) {
            const subagent = block.input?.subagent_type;
            if (block.type === 'tool_use' && block.name === 'Task' && typeof subagent === 'string') {
              dispatched.add(subagent);
            }
          }
        } else if (message.type === 'result') {
          if (message.subtype === 'success') {
            structuredOutput = message.structured_output;
          } else {
            throw new ReviewError(`Agent run ended without a result: ${message.subtype}`, mapSubtype(message.subtype), {
              subtype: message.subtype
            });
          }
        }
      }
    } catch (error) {
      if (isReviewError(error)) throw error;
      const cliError = cliStderr.trim().split('\n').slice(-3).join(' | ');
      throw new ReviewError(
        `Claude Code process failed: ${formatError(error)}${cliError ? ` (${cliError})` : ''}`,
        ErrorCodes.AGENT_FAILED,
        { cliStderr: cliStderr.trim() }
      );
    }

    const missing = EXPECTED_SUBAGENTS.filter(name => !dispatched.has(name));
    if (missing.length > 0) {
      logger.warn('Some subagents were never dispatched', { missing });
    }

    if (structuredOutput === undefined) {
      throw new ReviewError('The run finished without structured output', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    }

    const parsed = ReviewReportSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      throw new ReviewError('Structured output failed Zod validation', ErrorCodes.STRUCTURED_OUTPUT_FAILED, {
        issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    return parsed.data;
  }

  /**
   * The model writes findings; code writes numbers.
   * Overwrites summary, pullRequest and metadata so they are always correct.
   */
  private recalculate(
    report: ReviewReport,
    owner: string,
    repo: string,
    prNumber: number,
    duration: number
  ): ReviewReport {
    const files = report.fileReviews;
    const scores = files.map(f => f.codeQuality.overallScore);
    const overallScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    return {
      ...report,
      pullRequest: { owner, repo, number: prNumber },
      summary: {
        totalFiles: files.length,
        overallScore,
        criticalIssues: files.reduce(
          (n, f) => n + f.codeQuality.issues.filter(i => i.severity === 'critical').length,
          0
        ),
        highPriorityTests: files.reduce(
          (n, f) => n + f.testCoverage.untestedPaths.filter(p => p.priority === 'critical' || p.priority === 'high').length,
          0
        ),
        refactoringOpportunities: files.reduce((n, f) => n + f.refactorings.suggestions.length, 0)
      },
      metadata: {
        ...report.metadata,
        analyzedAt: new Date().toISOString(),
        duration
      }
    };
  }
}

/**
 * Retrying costs money (each attempt is a full review), so only retry
 * failures that might succeed on a second try.
 */
const NON_RETRYABLE_CODES = new Set<string>([
  ErrorCodes.STRUCTURED_OUTPUT_FAILED,
  ErrorCodes.INVALID_CONFIG,
  ErrorCodes.PR_NOT_FOUND
]);

export function isRetryable(error: unknown): boolean {
  if (!isReviewError(error)) return true; // unknown exception, e.g. network
  if (NON_RETRYABLE_CODES.has(error.code)) return false;
  const subtype = typeof error.metadata?.subtype === 'string' ? error.metadata.subtype : '';
  if (subtype.startsWith('error_max_')) return false; // budget or turns exhausted
  return true;
}

function mapSubtype(subtype: string | undefined): string {
  switch (subtype) {
    case 'error_max_structured_output_retries':
      return ErrorCodes.STRUCTURED_OUTPUT_FAILED;
    default:
      return ErrorCodes.AGENT_FAILED;
  }
}
