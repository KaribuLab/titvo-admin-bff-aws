/**
 * Finds a header in a headers object regardless of case.
 * @param headers Headers object
 * @param headerName Name of the header to look up
 * @returns The header value, or undefined if not present
 */
export function findHeaderCaseInsensitive (headers: Record<string, string | undefined>, headerName: string): string | undefined {
  const headerNameLower = headerName.toLowerCase()

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === headerNameLower) {
      return value
    }
  }

  return undefined
}
