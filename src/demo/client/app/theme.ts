/**
 * Dark mode follows the OS.
 *
 * The stylesheet is shadcn's stock theme, which swaps its tokens on a `.dark`
 * class rather than a media query. Rather than duplicate every token into a
 * `prefers-color-scheme` block, we set the class from the same signal. There
 * is no in-app toggle, so nothing else ever touches it.
 */
export function followSystemTheme(): void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", query.matches);
  apply();
  query.addEventListener("change", apply);
}
