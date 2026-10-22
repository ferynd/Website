export const REGISTERED_USERS_PAGE_SIZE = 100;
export const REGISTERED_USERS_MAX_PAGES = 50;

/** Fetch accounts in uid order, stopping between requests after cancellation. */
export async function fetchRegisteredUsers<T extends { uid: string }>(
  fetchPage: (cursor: string | undefined) => Promise<T[]>,
  isCancelled: () => boolean = () => false,
): Promise<T[]> {
  const users: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < REGISTERED_USERS_MAX_PAGES; page += 1) {
    if (isCancelled()) return users;
    const entries = await fetchPage(cursor);
    if (isCancelled()) return users;

    users.push(...entries);
    if (entries.length < REGISTERED_USERS_PAGE_SIZE) break;
    cursor = entries[entries.length - 1].uid;
  }

  return users;
}
