/**
 * A section card, the way the protocol site frames a figure: a white card
 * with a hairline border, the site's radius and a soft shadow, and a plain
 * heading in the heading ink. Applied to shadcn's Card (or a bare section)
 * rather than baked into it, so `components/ui/` stays stock shadcn.
 */

export const SECTION_CARD = "relative min-w-0 rounded-lg shadow-(--shadow-card)";

export const SECTION_TITLE = "text-[15px] font-semibold tracking-tight text-foreground";

/**
 * Tabs across the top of a section card: an underlined row on the card's
 * top edge, the active tab in the brand colour, as on the protocol site.
 * For shadcn's `TabsList variant="line"` and `TabsTrigger`.
 */
export const CARD_TAB_ROW =
  "w-full justify-start gap-2 border-b border-border p-0 px-3 group-data-horizontal/tabs:h-auto";

export const CARD_TAB =
  "h-12 flex-none gap-1.5 px-3 text-sm font-medium text-muted-foreground hover:text-foreground " +
  "data-active:text-brand after:bg-brand group-data-horizontal/tabs:after:bottom-[-1px]";
