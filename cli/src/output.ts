// The output layer. One Printer per invocation, built from the global flags.
//
// The contract that matters for agents: under `--json` every command emits a
// single `{"ok": true, "data": …}` object on stdout and nothing else, and every
// failure emits `{"ok": false, "error": {…}}` on stderr. Success is checkable
// with `.ok` alone, without knowing which command produced the payload.
//
// Human mode prints the column projection; `--json` prints the *raw* records.
// Columns are a reading affordance, and an agent wants full fidelity.
import type { ListResult } from 'pocketbase';
import type { ParsedAuthError } from '@project/shared';

export interface Column<T> {
  header: string;
  get: (row: T) => string;
  align?: 'left' | 'right';
}

export interface PrinterOptions {
  json: boolean;
  color: boolean;
  /** Injectable for tests; defaults to the real streams. */
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Terminal width for truncation. Defaults to `process.stdout.columns`. */
  width?: number;
}

const DEFAULT_WIDTH = 100;

export class Printer {
  readonly json: boolean;
  private readonly color: boolean;
  private readonly out: (text: string) => void;
  private readonly err: (text: string) => void;
  private readonly width: number;

  constructor(options: PrinterOptions) {
    this.json = options.json;
    this.color = options.color;
    this.out = options.stdout ?? ((text) => process.stdout.write(text + '\n'));
    this.err = options.stderr ?? ((text) => process.stderr.write(text + '\n'));
    this.width = options.width ?? process.stdout.columns ?? DEFAULT_WIDTH;
  }

  /**
   * A list of records. `columns` is the human projection; `--json` ignores it
   * and emits the records whole.
   *
   * A paged `ListResult` keeps its pagination envelope: under `--json` the
   * data is `{page, perPage, totalItems, totalPages, items}` — an agent that
   * got page 1 of 4 must be able to see there are three more — and in human
   * mode a footer says the same when anything was left unfetched. A plain
   * array (a client-side join with no server paging) emits bare rows.
   *
   * `empty` is the human-mode message for a zero-row result — "No graphs."
   * reads better than a bare header with nothing under it.
   */
  list<T>(
    result: readonly T[] | ListResult<T>,
    columns: Column<T>[],
    empty = 'Nothing found.'
  ) {
    const paged = !Array.isArray(result) ? (result as ListResult<T>) : null;
    const rows = paged ? paged.items : (result as readonly T[]);

    if (this.json) return this.data(paged ?? rows);
    if (rows.length === 0) return this.out(this.dim(empty));
    this.out(this.table(rows, columns));

    if (paged && paged.totalPages > 1) {
      this.out(
        this.dim(
          `page ${paged.page} of ${paged.totalPages} (${paged.totalItems} total) — --page <n> or --all for the rest`
        )
      );
    }
  }

  /** A single record, as aligned `key: value` lines. */
  detail<T>(record: T, fields: Array<[string, (row: T) => string]>) {
    if (this.json) return this.data(record);

    const width = Math.max(...fields.map(([label]) => label.length));
    const lines = fields
      .map(([label, get]) => {
        const value = get(record);
        return value === ''
          ? null
          : `${this.dim(label.padEnd(width))}  ${value}`;
      })
      .filter((line): line is string => line !== null);
    this.out(lines.join('\n'));
  }

  /** Arbitrary already-shaped JSON payload with a human fallback renderer. */
  data(value: unknown) {
    if (this.json) {
      this.out(JSON.stringify({ ok: true, data: value }));
    } else {
      this.out(JSON.stringify(value, null, 2));
    }
  }

  /**
   * Progress and confirmations. Suppressed under `--json` so stdout stays a
   * single parseable object.
   */
  note(message: string) {
    if (!this.json) this.out(message);
  }

  /** A caveat the user should see but which is not the result. Always stderr. */
  warn(message: string) {
    if (!this.json) this.err(this.yellow(`warning: ${message}`));
  }

  /** Raw human line, ignored under --json. Used by the tree/diagnostic views. */
  line(text = '') {
    if (!this.json) this.out(text);
  }

  /** The terminal failure render. Always stderr, in both modes. */
  fail(error: ParsedAuthError) {
    if (this.json) {
      this.err(
        JSON.stringify({
          ok: false,
          error: {
            type: error.type,
            message: error.message,
            fieldErrors: error.fieldErrors ?? {},
          },
        })
      );
      return;
    }

    this.err(this.red(`graphware: ${error.message}`));
    for (const [field, message] of Object.entries(error.fieldErrors ?? {})) {
      this.err(`  ${field}: ${message}`);
    }
  }

  /** A usage failure. Always stderr; the usage line goes with it. */
  usage(message: string, usage?: string) {
    if (this.json) {
      this.err(
        JSON.stringify({
          ok: false,
          error: { type: 'usage', message, fieldErrors: {} },
        })
      );
      return;
    }

    this.err(this.red(`graphware: ${message}`));
    if (usage) this.err(`\nUsage: ${usage}`);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private table<T>(rows: readonly T[], columns: Column<T>[]): string {
    const cells = rows.map((row) => columns.map((column) => column.get(row)));
    const widths = columns.map((column, i) =>
      Math.max(column.header.length, ...cells.map((row) => row[i].length))
    );

    // Shrink from the right until the row fits: the leftmost columns are the
    // identifying ones, so they are the last thing worth sacrificing.
    const gap = 2;
    let total =
      widths.reduce((sum, w) => sum + w, 0) + gap * (columns.length - 1);
    for (let i = widths.length - 1; i >= 0 && total > this.width; i--) {
      const excess = total - this.width;
      const shrink = Math.min(excess, Math.max(0, widths[i] - 3));
      widths[i] -= shrink;
      total -= shrink;
    }

    const render = (values: string[]) =>
      values
        .map((value, i) => {
          const text = truncate(value, widths[i]);
          return columns[i].align === 'right'
            ? text.padStart(widths[i])
            : text.padEnd(widths[i]);
        })
        .join(' '.repeat(gap))
        .trimEnd();

    const header = this.dim(render(columns.map((column) => column.header)));
    return [header, ...cells.map(render)].join('\n');
  }

  private dim(text: string) {
    return this.color ? `\x1b[2m${text}\x1b[0m` : text;
  }

  private red(text: string) {
    return this.color ? `\x1b[31m${text}\x1b[0m` : text;
  }

  private yellow(text: string) {
    return this.color ? `\x1b[33m${text}\x1b[0m` : text;
  }
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length <= width) return value;
  return value.slice(0, Math.max(0, width - 1)) + '…';
}

/**
 * Whether to emit ANSI. Honours NO_COLOR (https://no-color.org) and, crucially
 * for agents, goes quiet whenever stdout is not a terminal.
 */
export function shouldUseColor(
  flag: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
  isTty: boolean = Boolean(process.stdout.isTTY)
): boolean {
  if (flag === false) return false;
  if (env.NO_COLOR) return false;
  return isTty;
}
