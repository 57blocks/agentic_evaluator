/** Small modules with one bug each, for the coding scenarios: source, fix, test, and the failing test output. */

export const BUGGY_MODULES = [
  {
    name: "pricing",
    fn: "applyDiscount",
    buggy: "export function applyDiscount(price, pct) {\n  return price - pct;\n}\n",
    fixed: "export function applyDiscount(price, pct) {\n  return price * (1 - pct / 100);\n}\n",
    test: "import { applyDiscount } from '../src/pricing.js';\ntest('10% off 200', () => expect(applyDiscount(200, 10)).toBe(180));\n",
    failing: "FAIL tests/pricing.test.js\n  10% off 200: expected 180, received 190\n1 failed",
  },
  {
    name: "clamp",
    fn: "clamp",
    buggy: "export function clamp(n, lo, hi) {\n  return Math.min(lo, Math.max(n, hi));\n}\n",
    fixed: "export function clamp(n, lo, hi) {\n  return Math.min(hi, Math.max(n, lo));\n}\n",
    test: "import { clamp } from '../src/clamp.js';\ntest('inside', () => expect(clamp(5, 0, 10)).toBe(5));\ntest('above', () => expect(clamp(15, 0, 10)).toBe(10));\n",
    failing: "FAIL tests/clamp.test.js\n  inside: expected 5, received 0\n  above: expected 10, received 0\n2 failed",
  },
  {
    name: "slug",
    fn: "slugify",
    buggy: "export function slugify(s) {\n  return s.trim().replace(/\\s+/g, '-');\n}\n",
    fixed: "export function slugify(s) {\n  return s.trim().toLowerCase().replace(/\\s+/g, '-');\n}\n",
    test: "import { slugify } from '../src/slug.js';\ntest('lowercases', () => expect(slugify(' Hello World ')).toBe('hello-world'));\n",
    failing: "FAIL tests/slug.test.js\n  lowercases: expected 'hello-world', received 'Hello-World'\n1 failed",
  },
  {
    name: "cart",
    fn: "cartTotal",
    buggy: "export function cartTotal(items) {\n  return items.reduce((t, i) => t + i.price, 0);\n}\n",
    fixed: "export function cartTotal(items) {\n  return items.reduce((t, i) => t + i.price * i.qty, 0);\n}\n",
    test: "import { cartTotal } from '../src/cart.js';\ntest('counts quantity', () => expect(cartTotal([{ price: 3, qty: 2 }, { price: 5, qty: 1 }])).toBe(11));\n",
    failing: "FAIL tests/cart.test.js\n  counts quantity: expected 11, received 8\n1 failed",
  },
];
