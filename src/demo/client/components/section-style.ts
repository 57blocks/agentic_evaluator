/**
 * A section card, the way the protocol site frames a figure: a white card
 * with a hairline border, the site's radius and a soft shadow, and a plain
 * heading in the heading ink. Applied to shadcn's Card (or a bare section)
 * rather than baked into it, so `components/ui/` stays stock shadcn.
 */

export const SECTION_CARD = "relative min-w-0 rounded-lg shadow-(--shadow-card)";

export const SECTION_TITLE = "text-[15px] font-semibold tracking-tight text-foreground";
