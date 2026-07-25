import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  GameBootstrap,
  LegalActionSummary,
} from "@office-ladder/contracts";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  createEventFeedbackState,
  findLocalPromptAction,
  reduceEventFeedback,
  type EventFeedbackState,
  type EventNotice,
} from "./event-feedback-policy";
import {
  type AuthoredCardDraw,
  CardDrawDialog,
  resolveAuthoredCardDraw,
} from "./card-draw-dialog";

type PromptAction = Extract<
  LegalActionSummary,
  { readonly type: "prompt.respond" }
>;

type GameFeedbackProps = {
  readonly bootstrap: GameBootstrap;
  readonly error: string | null;
  readonly isResponding: boolean;
  readonly onIdleChange: (idle: boolean) => void;
  readonly onRespond: (optionId: string) => void;
};

export function GameFeedback({
  bootstrap,
  error,
  isResponding,
  onIdleChange,
  onRespond,
}: GameFeedbackProps) {
  const feedbackState = useRef<EventFeedbackState>(createEventFeedbackState());
  const [announcement, setAnnouncement] = useState("");
  const [cardQueue, setCardQueue] = useState<readonly AuthoredCardDraw[]>([]);
  const [processedRevision, setProcessedRevision] = useState<number | null>(null);
  const promptAction = findLocalPromptAction(bootstrap.legalActions);

  useEffect(() => {
    const result = reduceEventFeedback(
      feedbackState.current,
      bootstrap.publicProjection.eventSummaries,
      bootstrap.room,
      bootstrap.self.playerId,
    );
    feedbackState.current = result.state;
    setProcessedRevision(bootstrap.publicProjection.revision);
    if (result.cardDraws.length > 0) {
      setCardQueue((queue) => [
        ...queue,
        ...result.cardDraws.flatMap((draw) => {
          const authoredDraw = resolveAuthoredCardDraw(draw);
          return authoredDraw ? [authoredDraw] : [];
        }),
      ]);
    }
    if (result.notices.length === 0) return;

    const message = feedbackMessage(result.notices);
    setAnnouncement(message);
    toast.info("Activity updated", {
      id: result.notices.map((notice) => notice.eventId).join(":"),
      description: message,
      duration: 4_000,
    });
  }, [bootstrap]);

  useEffect(() => {
    if (processedRevision !== bootstrap.publicProjection.revision) return;
    onIdleChange(promptAction === null && cardQueue.length === 0);
  }, [bootstrap.publicProjection.revision, cardQueue.length, onIdleChange, processedRevision, promptAction]);

  return (
    <>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <PromptDialog
        action={promptAction}
        error={error}
        isResponding={isResponding}
        onRespond={onRespond}
      />
      <CardDrawDialog
        blocked={promptAction !== null}
        draw={cardQueue[0] ?? null}
        onContinue={() => setCardQueue((queue) => queue.slice(1))}
      />
    </>
  );
}

function PromptDialog({
  action,
  error,
  isResponding,
  onRespond,
}: {
  readonly action: PromptAction | null;
  readonly error: string | null;
  readonly isResponding: boolean;
  readonly onRespond: (optionId: string) => void;
}) {
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open, eventDetails) => {
        if (!open && action !== null) eventDetails.cancel();
      }}
    >
      <DialogContent showCloseButton={false} className="border-warning/50 sm:max-w-lg">
        <DialogHeader>
          <p className="ui-kicker text-warning">Decision required</p>
          <DialogTitle>
            {action?.kind === "audit-release" ? "Audit review" : "Choose a response"}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === "audit-release"
              ? "Choose how to leave audit confinement. The game will keep this decision open until the server accepts a response."
              : "Choose one of the legal responses below to continue the match."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="status-message status-message-error" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter className="sm:grid sm:grid-cols-2">
          {action?.options.map((optionId, index) => (
            <Button
              disabled={isResponding}
              key={optionId}
              onClick={() => onRespond(optionId)}
              type="button"
              variant={index === 0 ? "default" : "outline"}
            >
              {isResponding ? "Submitting" : promptOptionLabel(optionId)}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function feedbackMessage(notices: readonly EventNotice[]): string {
  const latest = notices.at(-1);
  if (!latest) return "";
  const latestMessage = `${latest.actorName} · ${eventTypeLabel(latest.eventType)}`;
  return notices.length === 1
    ? latestMessage
    : `${notices.length} updates committed. Latest: ${latestMessage}`;
}

const promptOptionLabels = {
  "pay-fine": "Pay the $500 fine",
  "attempt-roll": "Attempt release roll",
} as const satisfies Readonly<Record<string, string>>;

function promptOptionLabel(optionId: string): string {
  switch (optionId) {
    case "pay-fine":
      return promptOptionLabels["pay-fine"];
    case "attempt-roll":
      return promptOptionLabels["attempt-roll"];
    default:
      return eventTypeLabel(optionId);
  }
}

function eventTypeLabel(type: string): string {
  return type.replaceAll(".", " ").replaceAll("-", " ");
}
