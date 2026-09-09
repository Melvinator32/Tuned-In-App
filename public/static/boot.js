/* Tuned In — boot.js
   Kicks off the first state load. Loaded LAST so every view's functions are
   defined before the fetch resolves. */

// A local-first build has to open its in-browser database and install the API
// shim before anything asks for state; RS_LOCAL_READY resolves when it has.
// Absent on server builds, where the first call can go straight out.
// Every build ships a profile: scripts/build-profile.mjs writes one before each
// deploy. A missing one does not mean "no profile", it means the deploy is
// broken - and the damage is that the app comes up looking almost right. It
// keeps working, loses nothing, and quietly shows none of the content that
// makes it yours. That is far worse than refusing to start, because it can go
// unnoticed for days. So it refuses to start.
if (!window.PROFILE || !window.PROFILE.name) {
  showMissingProfile();
} else {
(window.RS_LOCAL_READY || Promise.resolve())
  .then(loadState)
  .then(() => {
    clearBootStatus();

    // Startup migrations and automations issue writes, and every write pushes an
    // undo snapshot. Clear them once the first load settles: the first Undo
    // should undo something you did, not the app starting up.
    undoStack.length = 0;
    redoStack.length = 0;
    if (typeof updateUndoButtons === "function") updateUndoButtons();

    // A board that was just created rather than reopened: say where it lives
    // before anyone fills it with work.
    if (window.RS_LOCAL && window.RS_LOCAL.fresh) {
      requestDurableStorage();
      showFirstRunNote();
    }

    // Nudge about backups once an hour, for the browsers that cannot save to a
    // file on their own. No-op on a server build.
    startBackupReminder();
  })
  .catch(showBootFailure);
}

/** The build is missing its profile. Say so plainly, and say what to do, because
 *  the person seeing this cannot fix it themselves. */
function showMissingProfile() {
  console.error("[tuned-in] no profile in this build - deploy did not include public/static/profile.js");
  const node = document.getElementById("boot-status");
  if (!node) return;
  node.innerHTML = "";
  node.className = "boot-status boot-status-error";
  node.append(el("h2", {}, "This version was not built correctly"));
  node.append(el("p", {},
    "The file describing which sections, goals and views this build should show "
    + "is missing, so the app has stopped rather than come up looking generic."));
  node.append(el("p", {}, "Nothing has been lost. Your board is untouched and will "
    + "be there once the app is deployed again."));
  node.append(el("p", { class: "boot-detail" },
    "Run the deploy again from a machine with the project checked out."));
}

/** Take down the placeholder the page ships with. The first render replaces the
 *  board's contents anyway; doing it explicitly means the success path does not
 *  depend on that staying true. */
function clearBootStatus() {
  const node = document.getElementById("boot-status");
  if (node) node.remove();
}

/** Something failed before the board could be drawn.
 *
 *  Without this the page just stays blank: the promise rejects, no view ever
 *  renders, and whoever is looking at it has nothing to report beyond "it did
 *  not work". On a local-first build the likeliest cause by far is a browser
 *  that will not hand out storage — a private window, or site data switched
 *  off — which is worth naming, because it is fixable by the person reading. */
function showBootFailure(err) {
  console.error("[tuned-in] the board could not be opened:", err);
  const node = document.getElementById("boot-status");
  if (!node) return;
  const local = !!window.RS_LOCAL_READY;
  node.innerHTML = "";
  node.className = "boot-status boot-status-error";
  node.append(el("h2", {}, "This board could not be opened"));
  node.append(el("p", {}, local
    ? "Tuned In keeps your board in this browser's own storage. Private and incognito "
      + "windows, and browsers set to block site data, do not allow that."
    : "The app could not reach the server that holds your board."));
  node.append(el("p", {}, local
    ? "Try opening this page in an ordinary window."
    : "Check your connection and reload the page."));
  node.append(el("p", { class: "boot-detail" },
    String(err && err.message ? err.message : err)));
}

/** Ask the browser not to evict the board when it is short of space.
 *
 *  Chromium and Firefox grant this to sites someone actually uses, and it is
 *  the difference between a board that survives and one that is quietly not
 *  there any more. Safari does not implement it, which is why iOS gets the
 *  home-screen note below instead. Best effort: a refusal changes nothing. */
function requestDurableStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {
    /* not supported here; nothing to fall back to */
  }
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS reports itself as a Mac; touch points are what give it away.
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Shown once, when a board is created rather than reopened.
 *
 *  Everything here follows from there being no server: nobody else can see the
 *  board, and nobody else can get it back either. The tagline in the header
 *  says the first half. This says the half that costs someone their work if
 *  they do not know it. */
function showFirstRunNote() {
  openModal("Before you start", (body, close) => {
    body.append(el("p", { style: "margin-top:0" },
      "Your board is saved in this browser, on this device. It is not on a server, "
      + "no one else can see it, and there is no account to sign in to."));
    body.append(el("p", {},
      "That also means you are the only backup. Open Export and choose Download "
      + "backup to save a copy you can restore later, or carry to another browser."));
    if (isIos()) {
      body.append(el("p", {},
        "On iPhone and iPad, add this page to your home screen. Safari clears stored "
        + "data for sites you have not opened in about a week, and pages added to the "
        + "home screen are exempt."));
    }
    const btns = el("div", { style: "display:flex;justify-content:flex-end;margin-top:16px" });
    btns.append(el("button", { class: "tool-btn accent-teal", onClick: () => close() }, "Got it"));
    body.append(btns);
  });
}
