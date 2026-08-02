/**
 * The openers offered to someone who has not described anything yet.
 *
 * Shared because both doors into the product need them and they must not
 * drift: the home hero shows them as chips, and the builder's empty
 * conversation panel shows them as rows. Landing on /builder directly used to
 * offer nothing at all.
 *
 * Each one is a whole, specific sentence rather than a category, because the
 * generator produces a better first draft from "a local plumbing company with
 * service booking" than from "plumber", and because a visitor reading these is
 * also learning how much detail to give.
 */
export const STARTERS = [
  "A cozy coffee shop in Tucson with a menu and online reservations",
  "A freelance photographer portfolio",
  "A local plumbing company with service booking",
  "An online store for handmade ceramics",
  "A yoga studio with a class schedule",
] as const;
