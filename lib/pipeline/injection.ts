/**
 * Deterministic backstop for prompt injection. The model's own flag is OR-ed
 * with this, so a susceptible model that misses an instruction still gets it
 * flagged. Ticket text is data: it never reaches the pricing function either way.
 */
const INJECTION =
  /ignore (?:all |your |the |any )?(?:previous |prior )?(?:instructions|polic(?:y|ies)|rules)|disregard (?:the |your |all )?(?:polic|rules|instructions)|system prompt|you are now|override (?:the |your )?polic|(?:issue|approve|grant|give) (?:me )?(?:a )?(?:credit of )?\$\d+/i;

export function detectInjection(text: string): boolean {
  return INJECTION.test(text);
}

/** The Ticket body, wrapped as delimited data for any model call. */
export function asTicketData(body: string): string {
  return `<ticket_data>\n${body}\n</ticket_data>`;
}
