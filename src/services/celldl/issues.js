/** Issues listed in a message before the rest are counted. */
const MAX_LISTED_ISSUES = 5

/**
 * Lists a conversion's issues one per line, after the element each names.
 *
 * @param {Array<{ message: string, elementId?: string }>} issues - bg2cellml issues.
 * @returns {string[]}
 */
export function issueLines(issues) {
  const lines = issues
    .slice(0, MAX_LISTED_ISSUES)
    .map((issue) => `• ${issue.elementId ? `${issue.elementId}: ` : ''}${issue.message}`)
  if (issues.length > MAX_LISTED_ISSUES) lines.push(`…and ${issues.length - MAX_LISTED_ISSUES} more`)
  return lines
}
