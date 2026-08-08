// Interactive prompts, for humans only — thin wrappers over @inquirer/prompts.
//
// The rule that matters: when stdin is not a TTY, never prompt — fail (or
// proceed) immediately instead. A CLI that blocks on a question nobody can
// answer is the single most common way an agent invocation hangs forever.
// Every call site checks `canPrompt(ctx)` first, which also covers `--json`:
// a prompt would corrupt the single-JSON-object stdout contract.
import { confirm, input, password, select } from '@inquirer/prompts';
import type { Ctx } from './context.ts';

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Whether this invocation may ask questions at all. */
export function canPrompt(ctx: Ctx): boolean {
  return isInteractive() && !ctx.printer.json;
}

/**
 * Ctrl-C inside an inquirer prompt throws rather than killing the process.
 * Matched by name, not instanceof: the class lives in @inquirer/core, which is
 * not a direct dependency, and a version skew must not break the detection.
 */
export function isPromptAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

export const ask = { confirm, input, password, select };
