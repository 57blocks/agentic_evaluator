/**
 * The accented card: a brand-coloured title under a thin gradient rule, the
 * way report.html frames every section. Applied to shadcn's Card rather than
 * baked into it, so `components/ui/` stays the stock shadcn it says it is.
 */

export const ACCENT_CARD =
  "relative min-w-0 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-linear-to-r before:from-brand before:to-brand-2";

export const ACCENT_TITLE = "text-[15px] font-bold tracking-wide text-brand";
