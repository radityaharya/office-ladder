import type { EffectDescriptor } from "@office-ladder/content";
import { deadlineDashContent } from "@office-ladder/content";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CardDrawNotice } from "./event-feedback-policy";

type AuthoredCard = (typeof deadlineDashContent.decks)[number]["cards"][number];
type AuthoredDeck = (typeof deadlineDashContent.decks)[number];

export type AuthoredCardDraw = {
  readonly notice: CardDrawNotice;
  readonly deck: AuthoredDeck;
  readonly card: AuthoredCard;
};

type CardDrawDialogProps = {
  readonly draw: AuthoredCardDraw | null;
  readonly blocked: boolean;
  readonly onContinue: () => void;
};

export function CardDrawDialog({ draw, blocked, onContinue }: CardDrawDialogProps) {
  const open = draw !== null && !blocked;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && open) eventDetails.cancel();
      }}
    >
      {draw ? (
        <DialogContent
          showCloseButton={false}
          className="rounded-sm border-border bg-card sm:max-w-lg"
          data-card-definition-id={draw.card.id}
        >
          <DialogHeader className="border-b border-border pb-4">
            <p className="ui-kicker text-muted-foreground">{deckLabel(draw.deck.id)}</p>
            <DialogTitle className="text-2xl tracking-tight normal-case">
              {cardName(draw.card)}
            </DialogTitle>
            <DialogDescription>
              {draw.notice.actorKind === "local"
                ? "You drew an office incident. Apply the committed effect, then continue."
                : `${draw.notice.actorName} drew an office incident. The server has already applied it.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2" aria-label="Card effects">
            {draw.card.effects.map((effect, index) => (
              <p
                className="border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                key={`${effect.type}-${index}`}
              >
                {effectLabel(effect)}
              </p>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={onContinue} type="button">
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function resolveAuthoredCardDraw(draw: CardDrawNotice): AuthoredCardDraw | null {
  for (const deck of deadlineDashContent.decks) {
    if (deck.id !== draw.card.deckId) continue;
    const card = deck.cards.find(
      (candidate) =>
        candidate.id === draw.card.definitionId &&
        candidate.nameKey === draw.card.nameKey,
    );
    if (card) return { notice: draw, deck, card };
  }
  return null;
}

function cardName(card: AuthoredCard): string {
  const idPart = card.id.split(".").at(-1);
  if (!idPart) return card.id;
  const label = idPart.replaceAll("-", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function deckLabel(deckId: string): string {
  const label = deckId.replace("deck.", "").replaceAll("-", " ");
  return `${label} card`;
}

function effectLabel(effect: EffectDescriptor): string {
  switch (effect.type) {
    case "drawCards":
      return `Draw ${effect.count} ${deckLabel(effect.deckId)}${effect.count === 1 ? "" : "s"}.`;
    case "modifyResource":
      return `${effect.amount >= 0 ? "Gain" : "Lose"} ${resourceAmount(effect.resource, Math.abs(effect.amount))}.`;
    case "restoreResourceToMaximum":
      return `Restore ${resourceLabel(effect.resource)} to maximum.`;
    case "payResource":
      return `Pay ${resourceAmount(effect.resource, effect.amount)}.`;
    case "incrementWorkCounter":
      return `Add ${effect.amount} work mark. Every ${effect.rewardEvery} marks grants ${resourceAmount(effect.reward.resource, effect.reward.amount)}.`;
    case "rollCheck":
      return `Roll ${effect.dice.count}d${effect.dice.sides}; the committed outcome applies immediately.`;
    case "applyStatus":
      return statusLabel(effect);
    case "skipTurns":
      return `Skip ${effect.count} turn${effect.count === 1 ? "" : "s"}.`;
    case "gainSalary":
      return `Collect salary when you ${effect.trigger}.`;
    case "grantExtraRoll":
      return "Take one extra roll.";
    case "attemptPromotion":
      return "Attempt the next promotion.";
    case "auditConfinement":
      return `Enter audit review. Roll true doubles or pay $${effect.release.alternativeFine}.`;
    default:
      return effect satisfies never;
  }
}

function resourceAmount(resource: string, amount: number): string {
  if (resource === "money") return `$${amount.toLocaleString()}`;
  return `${amount} ${resourceLabel(resource)}`;
}

function resourceLabel(resource: string): string {
  return resource.replace("resource.", "").replaceAll("-", " ");
}

function statusLabel(effect: Extract<EffectDescriptor, { readonly type: "applyStatus" }>): string {
  const status = effect.statusId.replace("status.", "").replaceAll("-", " ");
  const duration = `${effect.duration.count} ${effect.duration.kind}`;
  return `Apply ${status} for ${duration}.`;
}
