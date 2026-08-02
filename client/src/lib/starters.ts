/**
 * The openers offered to someone who has not described anything yet.
 *
 * Shared because both doors into the product need them and they must not
 * drift: the home hero shows them as a line of links, the builder's empty
 * conversation panel shows them as rows. Landing on /builder directly used to
 * offer nothing at all.
 *
 * `prompt` is a whole, specific sentence rather than a category, because the
 * generator produces a better first draft from "a local plumbing company with
 * service booking" than from "plumber", and because a visitor reading these is
 * also learning how much detail to give. `short` exists only so the hero can
 * set three of them on one line; it is never what gets sent.
 */
export interface Starter {
  prompt: string;
  short: string;
}

export const STARTERS: readonly Starter[] = [
  {
    prompt: "A cozy coffee shop in Tucson with a menu and online reservations",
    short: "a coffee shop",
  },
  { prompt: "A freelance photographer portfolio", short: "a portfolio" },
  {
    prompt: "A local plumbing company with service booking",
    short: "a plumbing company",
  },
  {
    prompt: "An online store for handmade ceramics",
    short: "an online store",
  },
  { prompt: "A yoga studio with a class schedule", short: "a yoga studio" },
] as const;
