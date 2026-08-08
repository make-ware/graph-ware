// The standard listing contract: every `ls`-style command takes the same four
// flags, composed the same way.
//
//   --filter   a PocketBase filter expression, ANDed onto the command's own
//              scope — it can narrow a listing but never escape it
//   --sort     comma-separated fields, '-' prefix for descending; when absent,
//              each collection's default sort applies
//   --page / --per-page   server-side pagination, pages starting at 1
//   --all      walk every page and return one combined list
//
// The flags ride on BaseMutator.getList, which AND-joins filter arrays and
// falls back to per-collection default sorts — so the scope filter stays a
// server-side guarantee, not something the user's --filter replaces.
import { Command, Option } from 'commander';
import type { ListResult } from 'pocketbase';
import { positiveInt } from './options.ts';

export interface ListOpts {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  all?: boolean;
}

/** The slice of BaseMutator every listing command drives. */
export interface Listable<T> {
  getList(
    page?: number,
    perPage?: number,
    filter?: string | string[],
    sort?: string,
    expand?: string | string[]
  ): Promise<ListResult<T>>;
}

const LIST_HELP = `
Filtering and sorting:
  --filter takes a PocketBase filter expression: field, operator, quoted value,
  combined with && and ||. Operators: = != > >= < <= ~ (contains) !~.
      --filter 'visibility = "public"'
      --filter 'label ~ "fuse" && created >= "2026-01-01"'
  It is ANDed with this command's own scope, so it can only narrow the result.

  --sort is a comma-separated field list, '-' prefix for descending:
      --sort '-created,label'

  Pages start at 1. --all fetches every page as one list.`;

/** Attach the standard listing flags (and their shared help section). */
export function addListOptions(command: Command): Command {
  return command
    .option(
      '-f, --filter <expr>',
      "narrow with a PocketBase filter expression (ANDed with the command's scope)"
    )
    .option(
      '-s, --sort <fields>',
      "comma-separated sort fields, '-' prefix for descending"
    )
    .option('-p, --page <n>', 'page to fetch, starting at 1', positiveInt, 1)
    .option(
      '--per-page <n>',
      'rows per page (server max 500)',
      positiveInt,
      100
    )
    .addOption(
      new Option('--all', 'fetch every page as one list').conflicts('page')
    )
    .addHelpText('after', LIST_HELP);
}

/**
 * One page (or, with --all, every page) of a listing.
 *
 * `scope` is the command's own restriction — "nodes of this graph", "graphs in
 * this workspace". It is joined to the user's --filter with &&, which is what
 * makes --filter safe to expose: there is no expression that widens the scope.
 */
export async function fetchList<T>(
  mutator: Listable<T>,
  scope: string | readonly string[] | undefined,
  opts: ListOpts,
  expand?: string | string[]
): Promise<ListResult<T>> {
  const filter = [
    ...(typeof scope === 'string' ? [scope] : (scope ?? [])),
    ...(opts.filter ? [opts.filter] : []),
  ];

  if (!opts.all) {
    return await mutator.getList(
      opts.page ?? 1,
      opts.perPage ?? 100,
      filter,
      opts.sort,
      expand
    );
  }

  // --all: page through at the server's cap. The loop re-reads totalPages each
  // round rather than trusting the first response, so rows created mid-walk
  // extend the walk instead of being silently dropped.
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  let totalItems = 0;
  do {
    const result = await mutator.getList(page, 500, filter, opts.sort, expand);
    items.push(...result.items);
    totalPages = result.totalPages;
    totalItems = result.totalItems;
    page++;
  } while (page <= totalPages);

  return { page: 1, perPage: items.length, totalItems, totalPages: 1, items };
}
