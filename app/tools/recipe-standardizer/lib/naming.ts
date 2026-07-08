/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * Suggest a "save as new" name: "Cookies" -> "Cookies v2",
 * "Cookies v2" -> "Cookies v3", skipping names already in use.
 */
export const suggestVersionName = (name: string, existingNames: string[]): string => {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const match = name.trim().match(/^(.*?)\s+v(\d+)$/i);
  const base = match ? match[1] : name.trim();
  let version = match ? parseInt(match[2], 10) + 1 : 2;
  let candidate = `${base} v${version}`;
  while (taken.has(candidate.toLowerCase())) {
    version += 1;
    candidate = `${base} v${version}`;
  }
  return candidate;
};
