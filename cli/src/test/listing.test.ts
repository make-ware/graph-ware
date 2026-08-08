// The standard listing contract: scope composition and --all pagination.
import { describe, expect, it, vi } from 'vitest';
import { fetchList } from '../listing.ts';

function resultPage(
  items: number[],
  page: number,
  totalItems: number,
  totalPages = 1
) {
  return { page, perPage: 500, totalItems, totalPages, items };
}

describe('fetchList', () => {
  it('joins the scope and the user filter as separate clauses', async () => {
    const getList = vi.fn(async () => resultPage([], 1, 0));

    await fetchList({ getList }, 'graph = "g1"', {
      filter: 'name ~ "fuse"',
      sort: '-created',
      page: 2,
      perPage: 10,
    });

    expect(getList).toHaveBeenCalledWith(
      2,
      10,
      ['graph = "g1"', 'name ~ "fuse"'],
      '-created',
      undefined
    );
  });

  it('works with no scope at all', async () => {
    const getList = vi.fn(async () => resultPage([], 1, 0));
    await fetchList({ getList }, undefined, {});
    expect(getList).toHaveBeenCalledWith(1, 100, [], undefined, undefined);
  });

  it('walks every page under --all and returns one combined list', async () => {
    const pages = [
      resultPage([1, 2], 1, 5, 3),
      resultPage([3, 4], 2, 5, 3),
      resultPage([5], 3, 5, 3),
    ];
    let call = 0;
    const getList = vi.fn(async () => pages[call++]);

    const result = await fetchList({ getList }, 'x = "1"', { all: true });

    expect(getList).toHaveBeenCalledTimes(3);
    expect(getList).toHaveBeenLastCalledWith(
      3,
      500,
      ['x = "1"'],
      undefined,
      undefined
    );
    expect(result.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.totalPages).toBe(1);
    expect(result.totalItems).toBe(5);
  });
});
