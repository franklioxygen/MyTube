/**
 * Sanitizes a string for safe use in HTML
 * Prevents XSS attacks
 */
export function sanitizeHtml(str: string): string {
  const map: { [key: string]: string } = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "/": "&#x2F;",
  };
  return str.replace(/[&<>"'/]/g, (s) => map[s]);
}
