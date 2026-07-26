import type { CardDrawNotice } from "../event-feedback-policy";

/**
 * Provenance line for a drawn card. The draw is already committed on the server
 * by the time the browser sees the event, so the copy never implies a pending
 * choice — it reports what happened, in the register DESIGN.md asks for
 * ("entries, not toasts").
 */
export function describeCardDrawSource(notice: CardDrawNotice): string {
  switch (notice.actorKind) {
    case "local":
      return "You drew this card. Its effects are already committed to the match record.";
    case "remote":
      return `${notice.actorName} drew this card. Its effects are already committed to the match record.`;
    case "system":
      return "The system drew this card. Its effects are already committed to the match record.";
  }
}
