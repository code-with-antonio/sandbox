/**
 * How long a game's title may be.
 *
 * Titles are rendered on one line in two places — the sidebar's list and the
 * game header — so this is a display limit rather than a storage one. It lives
 * here rather than beside the actions that enforce it because the rename dialog
 * caps its input at the same number, and a client component cannot import a
 * `"use server"` module's constants: every export of one has to be an action.
 */
export const TITLE_MAX_LENGTH = 80

/** A title cut to `TITLE_MAX_LENGTH`, with an ellipsis standing in for the rest. */
export function truncateTitle(title: string) {
  return title.length > TITLE_MAX_LENGTH
    ? `${title.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : title
}
