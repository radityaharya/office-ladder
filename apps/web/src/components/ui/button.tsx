import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * DESIGN.md compliance for this shared primitive (§5, §6.1, §8). Both the
 * overlay and card workflows flagged the previous version and could not edit it:
 *  - Five states on every variant. Hover steps the fill to `surface-raised` and
 *    the border to `border-strong`; active steps the fill DOWN to
 *    `surface-sunken` at 80ms (the control recedes into the desk on press — it
 *    no longer translates); disabled is opacity .5 and still legible-as-inert.
 *  - Focus-visible is a hard 2px accent OUTLINE at `outline-offset: 2px`,
 *    rendered outside the hairline. The previous soft `ring-2 ring-ring/40`
 *    halo is the one glow-adjacent effect §5 does not permit.
 *  - Radius: 2px for secondary/outline/ghost/destructive/link; 4px (the system
 *    ceiling) for the primary CTA only. Never a pill.
 *  - Heights: 28px pointer-target floor (§8), 36px default, 44px for the single
 *    largest action. Icon buttons are 28px square even though the glyph is 16px.
 *  - Tracking is the `label` token's 0.08em, not 0.12em.
 */
const buttonVariants = cva(
  "group/button inline-flex min-h-7 shrink-0 items-center justify-center rounded-sm border border-transparent bg-clip-padding text-xs font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-[background-color,border-color,color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] select-none focus-visible:[outline:2px_solid_var(--primary)] focus-visible:[outline-offset:2px] active:duration-[80ms] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-md border-[oklch(0_0_0_/_22%)] bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/70",
        outline:
          "border-border-strong bg-transparent hover:bg-surface-raised hover:text-foreground active:bg-surface-sunken aria-expanded:bg-surface-raised aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-surface-raised active:bg-surface-sunken aria-expanded:bg-surface-raised aria-expanded:text-secondary-foreground",
        ghost:
          "text-muted-foreground hover:bg-surface-raised hover:text-foreground active:bg-surface-sunken aria-expanded:bg-surface-raised aria-expanded:text-foreground",
        destructive:
          "border-destructive/40 bg-transparent text-destructive hover:bg-destructive/15 active:bg-destructive/25 focus-visible:[outline-color:var(--destructive)]",
        link: "text-primary underline underline-offset-4 hover:text-primary/85",
      },
      size: {
        default:
          "h-9 gap-2 px-6 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        lg: "h-11 gap-2 px-8 has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
