/* Tuned In — the first-run demo content.
 *
 * A fresh board opens on one believable person's life rather than an empty
 * grid, so every surface has something to show on the first click: values with
 * weights, goals with each kind of tracking, tasks tagged to those goals, and
 * twelve weeks of finished work so Progress draws a history instead of a flat
 * line.
 *
 * The person is a coaching client: a marketing manager working toward a move
 * into product, training for a half marathon, rebuilding savings and starting a
 * small ceramics shop on the side. Nothing here names a real person.
 *
 * Everything is relative to `today`, so the board looks current whenever it is
 * first opened. Goal ids are stable strings so tasks can tag them.
 */

/** YYYY-MM-DD shifted by `n` days. Done in UTC so a DST change can't skip a day. */
export function shiftDay(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The four built-in sections the app ships with. Listed as deleted so the
// coaching set below replaces them rather than sitting beside them.
export const DEMO_RETIRED_PILLARS = ["craft", "growth", "people", "wellbeing"];

// Values (sections). Weights sum to 100. Scope sorts them in Progress:
// "" = Professional, "personal", "ventures" = Side Hustle.
const DEMO_PILLARS = [
  { key: "health", label: "Health & Energy", color: "#38a66f", weight: 20, scope: "personal",
    why: "Everything else runs on sleep, movement and a body that has energy left at 6pm." },
  { key: "career", label: "Career & Purpose", color: "#00859b", weight: 25,
    why: "Work that uses my strengths and points somewhere I actually want to go." },
  { key: "rel", label: "Relationships", color: "#e2725b", weight: 20, scope: "personal",
    why: "The people who will still be here when the job title changes." },
  { key: "mind", label: "Mindset & Growth", color: "#77b28c", weight: 15, scope: "personal",
    why: "Responding instead of reacting. Learning on purpose." },
  { key: "money", label: "Financial Freedom", color: "#e0a92a", weight: 10, scope: "personal",
    why: "Enough runway that fear stops making my decisions." },
  { key: "venture", label: "Creative Venture", color: "#00bfb8", weight: 10, scope: "ventures",
    why: "Making something with my hands that strangers pay for." },
];

/** The goals. `pillar` is the value key above; `parent` nests a goal under
 *  another on the Map. Tracking covers every type the app offers. */
function demoGoals(today) {
  const d = (n) => shiftDay(today, n);
  const goal = (id, pillar, text, extra) => ({
    id, text, pillar, parent: null, seed: false, status: "active",
    why: "", plan: "", weaknessBoost: false, tracking: null, ...extra,
  });
  return [
    // Health & Energy
    goal("g_half", "health", "Run the Riverfront Half Marathon", {
      pin: true, pinOrder: 1,
      why: "Proof to myself that I can commit to something hard for twelve weeks and see it through.",
      plan: "Hal Higdon novice plan: 3 runs + 1 cross-train a week. Long run on Saturdays, building 1 mile a week. Book a gait analysis before week 6.",
      tracking: { type: "milestone", current: 0, target: 0, unit: "", deadline: d(68), milestones: [
        { text: "Register for the race", done: true },
        { text: "Run 5K without stopping", done: true },
        { text: "First 10K long run", done: true },
        { text: "Get fitted for proper shoes", done: false },
        { text: "10-mile long run", done: false },
        { text: "Race day", done: false },
      ] },
    }),
    goal("g_sleep", "health", "Sleep 7+ hours, five nights a week", {
      why: "Every bad week in my journal starts with a short night.",
      plan: "Phone charges in the kitchen. Lights out by 10:45. No work email after 8pm.",
      tracking: { type: "streak", current: 9, target: 30, unit: "nights", milestones: [], deadline: "" },
    }),
    goal("g_meals", "health", "Cook dinner at home four nights a week", {
      why: "Takeout is where both the money and the energy go.",
      plan: "Sunday: plan four meals and order groceries. Double the recipe on Monday for Tuesday lunch.",
      tracking: { type: "metric", current: 3, target: 4, unit: "nights / week", milestones: [], deadline: "" },
    }),

    // Career & Purpose
    goal("g_pm", "career", "Move into a Product Manager role by spring", {
      pin: true, pinOrder: 2,
      why: "I keep doing the parts of product work I love from the marketing side. Time to own it.",
      plan: "Finish the PM certificate, ship one cross-functional project as the de-facto PM, and have the internal transfer conversation with my director by end of quarter.",
      tracking: { type: "percent", current: 45, target: 0, unit: "", milestones: [], deadline: d(150) },
    }),
    goal("g_cert", "career", "Finish the product management certificate", {
      parent: "g_pm",
      why: "Gives me the vocabulary and a credential the hiring manager will recognise.",
      plan: "Two modules a week, Tuesday and Thursday evenings. Capstone uses the onboarding project.",
      tracking: { type: "metric", current: 6, target: 10, unit: "modules", milestones: [], deadline: "" },
    }),
    goal("g_speak", "career", "Present with confidence in leadership meetings", {
      weaknessBoost: true,
      why: "I go quiet when the VP is in the room, and it is costing me visibility. My coach flagged this as the one to work on.",
      plan: "Volunteer for one update a month. Rehearse out loud the night before. Open with the decision I need, not the background.",
      tracking: { type: "metric", current: 2, target: 6, unit: "presentations", milestones: [], deadline: "" },
    }),
    goal("g_network", "career", "Have 12 coffee chats with PMs", {
      parent: "g_pm",
      why: "Every PM I have talked to so far changed how I think about the move.",
      plan: "One a week. Ask each person for one more introduction.",
      tracking: { type: "metric", current: 7, target: 12, unit: "chats", milestones: [], deadline: "" },
    }),

    // Relationships
    goal("g_date", "rel", "Protect a weekly date night", {
      why: "We have become very good logistics partners. I want us to be more than that.",
      plan: "Thursdays, on the shared calendar. Phones in a drawer. Take turns planning.",
      tracking: { type: "streak", current: 5, target: 12, unit: "weeks", milestones: [], deadline: "" },
    }),
    goal("g_family", "rel", "Call Mom and Dad every Sunday", {
      why: "They are getting older and I only ever call when something is wrong.",
      plan: "Sunday after the long run. Ten minutes counts.",
      tracking: { type: "streak", current: 7, target: 52, unit: "weeks", milestones: [], deadline: "" },
    }),
    goal("g_friends", "rel", "Host a dinner for friends once a month", {
      why: "Friendships after 30 need a calendar invite or they quietly fade.",
      plan: "First Saturday of the month. Simple menu. Invite one new person each time.",
      tracking: { type: "metric", current: 2, target: 6, unit: "dinners", milestones: [], deadline: "" },
    }),

    // Mindset & Growth
    goal("g_meditate", "mind", "Meditate 10 minutes every morning", {
      why: "On days I sit first, I answer emails instead of reacting to them.",
      plan: "Right after coffee, before the phone. Headspace basics, then unguided.",
      tracking: { type: "streak", current: 18, target: 60, unit: "days", milestones: [], deadline: "" },
    }),
    goal("g_read", "mind", "Read 20 books this year", {
      why: "Reading is the cheapest mentor there is.",
      plan: "20 minutes before bed instead of scrolling. Alternate one work book, one fiction.",
      tracking: { type: "metric", current: 13, target: 20, unit: "books", milestones: [], deadline: "" },
    }),
    goal("g_journal", "mind", "Weekly reflection before every coaching session", {
      status: "done",
      why: "Sessions are twice as useful when I arrive knowing what I want from them.",
      plan: "Friday afternoon: wins, what drained me, one question for my coach.",
      tracking: { type: "streak", current: 8, target: 8, unit: "weeks", milestones: [], deadline: "" },
    }),

    // Financial Freedom
    goal("g_fund", "money", "Build a 6-month emergency fund", {
      why: "Changing careers is far less scary with runway in the bank.",
      plan: "Automatic transfer the day after payday. Every bonus and side-shop dollar goes here until it is full.",
      tracking: { type: "metric", current: 11400, target: 21000, unit: "$", milestones: [], deadline: "" },
    }),
    goal("g_debt", "money", "Pay off the credit card", {
      status: "done",
      why: "Interest was quietly eating what I saved.",
      plan: "Avalanche method, extra $400 a month.",
      tracking: { type: "percent", current: 100, target: 0, unit: "", milestones: [], deadline: "" },
    }),

    // Creative Venture
    goal("g_shop", "venture", "Open the ceramics shop online", {
      why: "I have forty mugs in the garage and a waiting list of friends. Let's find out if strangers agree.",
      plan: "Photograph the first collection, set up the storefront, launch to the newsletter list.",
      tracking: { type: "deadline", current: 0, target: 0, unit: "", milestones: [], deadline: d(45) },
    }),
    goal("g_sales", "venture", "Sell the first 25 pieces", {
      parent: "g_shop",
      why: "25 sales to people I don't know is the signal that this is more than a hobby.",
      plan: "Launch collection of 30. Two craft fairs this autumn.",
      tracking: { type: "metric", current: 4, target: 25, unit: "pieces", milestones: [], deadline: "" },
    }),
  ];
}

/** The whole goals_os blob, as the Goals view saves it. */
export function demoGoalsBlob(today) {
  return {
    v: 2,
    identity: "I am someone who keeps promises to myself.",
    objective: "Make the move into product without losing my health, my relationships or my savings along the way.",
    weekly: "", monthly: "",
    inputs: {}, setup: {}, ledgerAdds: [], links: {}, expLinks: {}, expDone: {},
    groupPillars: {}, groupSeen: [], hiddenPillars: [], hiddenIdeas: [],
    mapDir: "h",
    // Flags the one-time migrations in goals.js check, so none of them treat
    // the demo as an old database that needs repairing.
    fwSeeded: 1, impAbsorbed: 1, roleExpSeed: "v2", secRoleRev: "v2",
    personalRev: "v2", scV3: "v1", scRolesRev: "v1",
    deletedPillars: DEMO_RETIRED_PILLARS.slice(),
    pillars: DEMO_PILLARS.map((p) => ({ ...p, base: false })),
    ideas: demoGoals(today),
  };
}

/** The board's tasks: [group, cells, subtasks?]. `goal` names a goal id; the
 *  Values and Goal cells are filled from it. Done tasks carry `done` (days
 *  ago) and are stamped with __done_date so Progress has a history. */
export function demoTasks(today) {
  const d = (n) => shiftDay(today, n);
  const pillarOf = Object.fromEntries(demoGoals(today).map((g) => [g.id, g.pillar]));
  const T = (group, name, status, opts = {}) => {
    const cells = {
      c_name: name, c_status: status, c_owner: opts.owner || "Me",
      c_due: opts.due == null ? "" : d(opts.due),
      c_priority: opts.pri || "Medium", c_hours: opts.hrs ?? 1,
    };
    if (opts.goal) {
      cells.c_goal = "idea:" + opts.goal;
      cells.c_pillar = "pillar:" + pillarOf[opts.goal];
    } else if (opts.value) {
      cells.c_pillar = "pillar:" + opts.value;
    }
    if (status === "Done") cells.__done_date = d(-(opts.done || 0));
    const subs = (opts.subs || []).map(([nm, st]) => ({
      c_name: nm, c_status: st, c_owner: "Me", c_due: "", c_priority: "Medium", c_hours: 0.5,
      ...(st === "Done" ? { __done_date: d(-(opts.subDone || 1)) } : {}),
    }));
    return [group, cells, subs];
  };

  return [
    // ---- In progress now
    T("All Active Tasks", "Prep three questions for Thursday's coaching session", "Working On It",
      { due: 1, pri: "High", hrs: 0.5, goal: "g_speak" }),
    T("All Active Tasks", "Draft the product brief for the onboarding redesign", "Working On It",
      { due: 3, pri: "Critical", hrs: 4, goal: "g_pm", subs: [
        ["Interview 5 customers who churned", "Done"],
        ["Summarise the support-ticket themes", "Done"],
        ["Write the problem statement", "Working On It"],
        ["Review with engineering lead", "Not Started"],
      ], subDone: 4 }),
    T("All Active Tasks", "Certificate module 7: prioritisation frameworks", "Working On It",
      { due: 2, pri: "High", hrs: 3, goal: "g_cert" }),
    T("All Active Tasks", "Saturday long run — 8 miles", "Not Started",
      { due: 3, pri: "High", hrs: 1.5, goal: "g_half" }),
    T("All Active Tasks", "Book a gait analysis at the running shop", "Not Started",
      { due: 5, pri: "Medium", hrs: 1, goal: "g_half" }),
    T("All Active Tasks", "Photograph the launch collection", "Working On It",
      { due: 6, pri: "High", hrs: 3, goal: "g_shop", subs: [
        ["Buy a light box and backdrop", "Done"],
        ["Shoot mugs and bowls", "Not Started"],
        ["Edit and crop for the storefront", "Not Started"],
      ], subDone: 2 }),
    T("All Active Tasks", "Try changing a Status — watch the task move groups", "Not Started",
      { pri: "Low", hrs: 0.25 }),

    // ---- Health & Home
    T("Health & Home", "Plan four dinners and order groceries", "Not Started",
      { due: 2, pri: "Medium", hrs: 0.5, goal: "g_meals" }),
    T("Health & Home", "Move the phone charger to the kitchen", "Not Started",
      { due: 0, pri: "Low", hrs: 0.25, goal: "g_sleep" }),
    T("Health & Home", "Book annual physical", "Not Started",
      { due: 14, pri: "Medium", hrs: 0.5, value: "health" }),
    T("Health & Home", "Yoga class — cross-training day", "Not Started",
      { due: 1, pri: "Low", hrs: 1, goal: "g_half" }),

    // ---- Career & Money
    T("Career & Money", "Ask to present the Q3 campaign results at the leadership sync", "Not Started",
      { due: 4, pri: "High", hrs: 0.5, goal: "g_speak" }),
    T("Career & Money", "Coffee chat with Priya (Senior PM, payments team)", "Not Started",
      { due: 7, pri: "Medium", hrs: 1, goal: "g_network" }),
    T("Career & Money", "Update LinkedIn headline and About section", "Not Started",
      { due: 10, pri: "Medium", hrs: 1.5, goal: "g_pm" }),
    T("Career & Money", "Raise the automatic savings transfer by $150", "Not Started",
      { due: 1, pri: "High", hrs: 0.25, goal: "g_fund" }),
    T("Career & Money", "Review insurance and cancel unused subscriptions", "Not Started",
      { due: 12, pri: "Low", hrs: 1, goal: "g_fund" }),

    // ---- Relationships
    T("Relationships", "Plan Thursday date night — the new Thai place", "Not Started",
      { due: 2, pri: "High", hrs: 0.5, goal: "g_date" }),
    T("Relationships", "Send invites for October friends' dinner", "Not Started",
      { due: 4, pri: "Medium", hrs: 0.5, goal: "g_friends" }),
    T("Relationships", "Birthday card and gift for Sam", "Not Started",
      { due: 9, pri: "Medium", hrs: 0.5, value: "rel" }),

    // ---- Side Venture
    T("Side Venture", "Write product descriptions for 12 pieces", "Not Started",
      { due: 9, pri: "Medium", hrs: 2, goal: "g_shop" }),
    T("Side Venture", "Apply for a booth at the Harvest Craft Fair", "Not Started",
      { due: 5, pri: "High", hrs: 1, goal: "g_sales" }),
    T("Side Venture", "Glaze firing — second batch", "Not Started",
      { due: 8, pri: "Medium", hrs: 3, goal: "g_sales" }),

    // ---- Waiting / with someone else / parked
    T("Waiting for Feedback", "Weekly reflection sent to coach — awaiting notes", "Waiting for Feedback",
      { due: 1, pri: "Medium", hrs: 0.5, owner: "Coach", goal: "g_speak" }),
    T("Waiting for Feedback", "Shared the brief outline with my director", "Waiting for Feedback",
      { due: 4, pri: "High", hrs: 0.5, goal: "g_pm" }),
    T("Someone Else' Court", "Financial planner reviewing the savings plan", "In Someone Else' Court",
      { due: 10, pri: "Medium", hrs: 1, owner: "Planner", goal: "g_fund" }),
    T("Someone Else' Court", "Partner choosing the anniversary weekend dates", "In Someone Else' Court",
      { due: 14, pri: "Medium", hrs: 0.5, owner: "Partner", goal: "g_date" }),
    T("Holding Pattern / Pending", "Kiln upgrade — wait until 25 sales", "Holding Pattern",
      { pri: "Low", hrs: 2, goal: "g_sales" }),
    T("Holding Pattern / Pending", "Spring trip to Portugal — revisit after the emergency fund", "Holding Pattern",
      { pri: "Low", hrs: 2, value: "money" }),

    // ---- Done: twelve weeks of history for Progress and the goal sparklines
    T("Done", "Register for the Riverfront Half", "Done", { pri: "High", hrs: 0.5, goal: "g_half", done: 76 }),
    T("Done", "First coaching session — values exercise", "Done", { pri: "High", hrs: 1, goal: "g_journal", done: 74 }),
    T("Done", "Set up the automatic savings transfer", "Done", { pri: "High", hrs: 0.5, goal: "g_fund", done: 70 }),
    T("Done", "Certificate module 1: what a PM does", "Done", { pri: "Medium", hrs: 2, goal: "g_cert", done: 67 }),
    T("Done", "Coffee chat with Marcus (PM, growth)", "Done", { pri: "Medium", hrs: 1, goal: "g_network", done: 63 }),
    T("Done", "Final credit card payment", "Done", { pri: "High", hrs: 0.25, goal: "g_debt", done: 60 }),
    T("Done", "Certificate modules 2 and 3", "Done", { pri: "Medium", hrs: 4, goal: "g_cert", done: 55 }),
    T("Done", "Run 5K without stopping", "Done", { pri: "High", hrs: 0.5, goal: "g_half", done: 52 }),
    T("Done", "Hosted September friends' dinner", "Done", { pri: "Medium", hrs: 3, goal: "g_friends", done: 47 }),
    T("Done", "Presented the campaign recap to my team", "Done", { pri: "High", hrs: 1, goal: "g_speak", done: 44 }),
    T("Done", "Coffee chats with Lena and Omar", "Done", { pri: "Medium", hrs: 2, goal: "g_network", done: 40 }),
    T("Done", "Certificate module 4: discovery", "Done", { pri: "Medium", hrs: 2, goal: "g_cert", done: 36 }),
    T("Done", "Finished 'Atomic Habits'", "Done", { pri: "Low", hrs: 1, goal: "g_read", done: 33 }),
    T("Done", "Throw and trim the launch collection", "Done", { pri: "Medium", hrs: 6, goal: "g_shop", done: 30 }),
    T("Done", "First 10K long run", "Done", { pri: "High", hrs: 1.25, goal: "g_half", done: 27 }),
    T("Done", "Weekend away — no laptops", "Done", { pri: "High", hrs: 4, goal: "g_date", done: 24 }),
    T("Done", "Sold four mugs to the neighbours' group chat", "Done", { pri: "Medium", hrs: 1, goal: "g_sales", done: 20 }),
    T("Done", "Certificate module 5: roadmaps", "Done", { pri: "Medium", hrs: 2, goal: "g_cert", done: 17 }),
    T("Done", "Spoke up first in the leadership sync", "Done", { pri: "High", hrs: 0.5, goal: "g_speak", done: 13 }),
    T("Done", "Coffee chats with Ana, Jordan and Wei", "Done", { pri: "Medium", hrs: 3, goal: "g_network", done: 10 }),
    T("Done", "Certificate module 6: metrics", "Done", { pri: "Medium", hrs: 2, goal: "g_cert", done: 6 }),
    T("Done", "Meal-prepped for the week", "Done", { pri: "Low", hrs: 2, goal: "g_meals", done: 4 }),
    T("Done", "Called Mom and Dad", "Done", { pri: "Medium", hrs: 0.5, goal: "g_family", done: 3 }),
    T("Done", "Moved $500 of the bonus into savings", "Done", { pri: "Medium", hrs: 0.25, goal: "g_fund", done: 2 }),
  ];
}

/** Time blocks for the first day the board is opened, so Today isn't blank.
 *  [start, minutes, label, task name or null, color]. */
export const DEMO_TODAY_BLOCKS = [
  ["06:30", 15, "Meditate", null, "#77b28c"],
  ["07:00", 45, "Easy 3-mile run", null, "#38a66f"],
  ["09:00", 120, null, "Draft the product brief for the onboarding redesign", null],
  ["12:00", 30, "Lunch walk — no phone", null, "#bce194"],
  ["14:00", 60, "Coaching session", null, "#00859b"],
  ["19:30", 60, null, "Certificate module 7: prioritisation frameworks", null],
];
