import { describe, expect, it, vi } from 'vitest';
import {
  fetchRegisteredUsers,
  REGISTERED_USERS_MAX_PAGES,
  REGISTERED_USERS_PAGE_SIZE,
} from '../registeredUsers';

function accounts(start: number, count = REGISTERED_USERS_PAGE_SIZE) {
  return Array.from({ length: count }, (_, index) => ({ uid: `user-${start + index}` }));
}

describe('registered account pagination', () => {
  it('walks full pages with the last uid as cursor and includes a short final page', async () => {
    const pages = [accounts(0), accounts(100), accounts(200, 3)];
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(pages[0])
      .mockResolvedValueOnce(pages[1])
      .mockResolvedValueOnce(pages[2]);

    expect(await fetchRegisteredUsers(fetchPage)).toEqual(pages.flat());
    expect(fetchPage.mock.calls).toEqual([[undefined], ['user-99'], ['user-199']]);
  });

  it('stops on an empty page after an exactly full page', async () => {
    const page = accounts(0);
    const fetchPage = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce([]);

    expect(await fetchRegisteredUsers(fetchPage)).toEqual(page);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenLastCalledWith('user-99');
  });

  it('stops after the safety cap even when every page is full', async () => {
    let next = 0;
    const fetchPage = vi.fn(async () => {
      const page = accounts(next);
      next += REGISTERED_USERS_PAGE_SIZE;
      return page;
    });

    const users = await fetchRegisteredUsers(fetchPage);
    expect(REGISTERED_USERS_MAX_PAGES).toBe(50);
    expect(fetchPage).toHaveBeenCalledTimes(REGISTERED_USERS_MAX_PAGES);
    expect(users).toHaveLength(REGISTERED_USERS_MAX_PAGES * REGISTERED_USERS_PAGE_SIZE);
    expect(fetchPage).toHaveBeenLastCalledWith('user-4899');
    expect(users[users.length - 1].uid).toBe('user-4999');
  });

  it('does not start reading when already cancelled', async () => {
    const fetchPage = vi.fn();

    expect(await fetchRegisteredUsers(fetchPage, () => true)).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('does not fetch another page or retain the pending page after cancellation', async () => {
    let cancelled = false;
    const fetchPage = vi.fn(async () => {
      cancelled = true;
      return accounts(0);
    });

    expect(await fetchRegisteredUsers(fetchPage, () => cancelled)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('propagates read errors instead of presenting incomplete results as complete', async () => {
    const failure = new Error('Read failed');
    const fetchPage = vi.fn().mockResolvedValueOnce(accounts(0)).mockRejectedValueOnce(failure);

    await expect(fetchRegisteredUsers(fetchPage)).rejects.toBe(failure);
  });
});
