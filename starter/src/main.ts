import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CodeReviewOrchestrator } from './orchestrator';
import { ReportGenerator } from './utils/report-generator';
import { formatError, isReviewError } from './utils/error-handler';
import { logger } from './utils/logger';

const USAGE = 'Usage: npm run dev -- <owner> <repo> <pr-number>\n  Example: npm run dev -- udacity cd14715-simple-todo-app 1';

function fail(message: string, hint?: string): never {
  console.error(` ${message}`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
}

/** Validate CLI args */
function parseArgs(argv: string[]): { owner: string; repo: string; prNumber: number } {
  const [owner, repo, prStr] = argv;
  if (!owner || !repo || !prStr) fail('Missing arguments.', USAGE);

  if (!/^[A-Za-z0-9-]+$/.test(owner)) fail(`Invalid owner "${owner}".`, 'Use letters, digits and hyphens only.');
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) fail(`Invalid repo "${repo}".`, 'Use letters, digits, dots, underscores and hyphens.');

  const prNumber = Number(prStr);
  if (!/^\d+$/.test(prStr) || !Number.isSafeInteger(prNumber) || prNumber < 1) {
    fail(`Invalid PR number "${prStr}".`, 'It must be a positive integer.');
  }
  return { owner, repo, prNumber };
}

/** Validate env */
function validateEnv(): void {
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

  if (!hasApiKey) {
    fail(
      'No Anthropic credentials found.',
      'Set ANTHROPIC_API_KEY in .env'
    );
  }

  if (!process.env.ANTHROPIC_MODEL) {
    fail(
      'ANTHROPIC_MODEL is not set.',
      'Anthropic API: claude-sonnet-4-5-20250929'
    );
  }

  const projectRoot = process.env.PROJECT_ROOT;
  if (!projectRoot) fail('PROJECT_ROOT is not set.', 'Set it to the absolute path of project/starter in .env.');
  if (!existsSync(join(projectRoot, '.claude', 'skills'))) {
    fail(`PROJECT_ROOT does not contain .claude/skills: ${projectRoot}`, 'Skills will not load. Fix PROJECT_ROOT.');
  }

  if (!process.env.GITHUB_TOKEN) {
    console.warn('GITHUB_TOKEN not set: public repos work, but GitHub rate limits are low.');
  }
}

async function main(): Promise<void> {
  const { owner, repo, prNumber } = parseArgs(process.argv.slice(2));
  validateEnv();

  console.log(`Reviewing ${owner}/${repo}#${prNumber} ...`);

  const orchestrator = new CodeReviewOrchestrator();
  const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

  const generator = new ReportGenerator();
  const outDir = resolve(process.cwd(), 'reports');
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${owner}-${repo}-pr-${prNumber}`);

  writeFileSync(`${base}.json`, generator.generateJSONReport(report), 'utf-8');
  writeFileSync(`${base}.md`, generator.generateMarkdownReport(report), 'utf-8');
  writeFileSync(`${base}.html`, generator.generateHTMLReport(report), 'utf-8');

  const s = report.summary;
  console.log(`\n Done. Overall score ${s.overallScore}/100, ${s.totalFiles} files, ${s.criticalIssues} critical issues.`);
  console.log(`   ${base}.{json,md,html}`);
}

main().catch((error: unknown) => {
  logger.error('CLI failed', { error: formatError(error) });
  if (isReviewError(error)) {
    fail(`${error.message}`, `Error code: ${error.code}`);
  }
  fail(formatError(error));
});
