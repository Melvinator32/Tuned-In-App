/* Tuned In — the distribution profile.
 *
 * Selected at deploy time by scripts/build-profile.mjs. This is what a copy
 * handed to somebody else runs: the same application with fewer parts and its
 * own skin. Nothing here is personal, and no personal file is uploaded
 * alongside it.
 *
 * Trim `views` to change which tabs exist, `goalSubviews` for the Goals
 * sub-navigation, and `tokens` to re-skin. Views are removed rather than
 * disabled, and setView refuses a hidden one, so a keyboard shortcut or a
 * stale localStorage entry cannot reach a view that isn't there.
 */
window.PROFILE = {
  name: "default",

  // The core board plus Goals. Notebook, PARA, Zen Garden, Skill Lab and
  // Rewards are left out — they are the most personal surfaces and the least
  // explicable without context.
  views: ["table", "kanban", "today", "matrix", "goals"],

  // Improvements and the Operating System pages assume a career scorecard
  // that a fresh board has no content for.
  goalSubviews: ["dash", "progress"],

  branding: {
    title: "Tuned In",
    tagline: "A flexible board for work you actually care about",
  },

  // A cooler, more neutral palette than the personal build's, to make the two
  // deployments obviously different at a glance. Every one of these is a token
  // the stylesheet already uses, so nothing else has to change.
  tokens: {
    "--teal": "#3f7d8c",
    "--cyan": "#2f6675",
    "--pale-teal": "#e4eef0",
    "--sage": "#6f8a80",
    "--page-bg": "#f4f5f4",
  },
};
