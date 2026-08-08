// Interactive credential entry, for humans only.
//
// The rule that matters: when stdin is not a TTY and the credentials are not in
// the environment, fail immediately with an actionable message. A CLI that
// blocks on a prompt nobody can answer is the single most common way an agent
// invocation hangs forever.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Read a secret without echoing it.
 *
 * readline has no built-in masking, so the output stream is wrapped in one that
 * drops everything after the prompt has been written.
 */
export async function promptSecret(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });

  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });

  try {
    const answer = rl.question(question);
    muted = true;
    const value = await answer;
    process.stdout.write('\n');
    return value;
  } finally {
    muted = false;
    rl.close();
  }
}
