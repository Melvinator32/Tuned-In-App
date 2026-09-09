/* Tuned In — the local-first profile.
 *
 * The build people download and use: their board lives in their own browser,
 * in a SQLite database held in IndexedDB. No account, no server holding their
 * data, and nothing shared with anyone else who opens the same URL.
 *
 * `storage: "local"` is what turns it on. public/static/localdb.js then runs
 * the same API handlers from src/ against that in-browser database, so there
 * is one implementation of the API rather than one per runtime — see the notes
 * at the top of that file.
 *
 * The trade-off is honest and worth stating plainly: the board is tied to that
 * browser on that device. Clearing site data erases it, there is no sync to a
 * phone, and nobody can recover it for them. Export is the backup.
 */
window.PROFILE = {
  name: "local",

  // Everything runs in the browser.
  storage: "local",

  // The same trimmed set the hosted distribution build ships, for the same
  // reason: these are the surfaces that need the most context to make sense.
  views: ["table", "kanban", "today", "matrix", "goals"],
  goalSubviews: ["dash", "progress"],

  branding: {
    title: "Tuned In",
    tagline: "Your board, in your browser — nothing leaves this device",
  },

  tokens: {
    "--teal": "#3f7d8c",
    "--cyan": "#2f6675",
    "--pale-teal": "#e4eef0",
    "--sage": "#6f8a80",
    "--page-bg": "#f4f5f4",
  },
};
