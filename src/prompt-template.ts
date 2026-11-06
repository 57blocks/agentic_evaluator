/**
 * The one place `{{input}}` is filled, so the prompt a candidate is sent and
 * the prompt the report shows are built the same way.
 */

export const INPUT_PLACEHOLDER = "{{input}}";

/**
 * `template` with its first `{{input}}` replaced by `input`, verbatim. A
 * function replacer, because a string one reads `$&`, `$'` and `$1` in the
 * input as replacement patterns and quietly sends the model something else.
 */
export function fillTemplate(template: string, input: string): string {
  return template.replace(INPUT_PLACEHOLDER, () => input);
}
