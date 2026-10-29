/*
 * Nitid Planner frontend.
 *
 * Every task has a stage and a project, so it shows on two boards: the Time
 * Board (one colour column per fixed stage, the last one "Fet" holding done
 * tasks) and the Project Board (one column per project, done tasks folded
 * into a "Fet" list at the bottom). Timeline is a Gantt of the dated tasks.
 * Members come from data/members.json and are edited by hand.
 *
 * Interaction model:
 *   - click a task    -> editor dialog; every field saves on change.
 *   - tick a task     -> done (moves to Fet); untick -> back to the stage it had.
 *   - drag a task     -> move it within or across columns. On the Time Board,
 *                        dropping in Fet ticks it and dragging out unticks it.
 *   - + Add a task    -> inline composer; the column gives one of stage /
 *                        project, the composer asks for the other. It stays
 *                        open so several tasks can be typed in a row.
 *   - + Add project / the "+" after the project filters -> name + colour form.
 *
 * Filters are toggle sets: empty set = show all. A task matches a set when it
 * has any of the selected values; search and the two sets combine with AND.
 * The first set follows the board: status on the Project Board (its columns
 * are already projects), projects everywhere else. Each keeps its selection.
 *
 * The server is the source of truth; every mutation re-fetches.
 */

const state = {
  board: { stages: [], projects: [], members: [], tasks: [], colors: [], done_stage: "" },
  view: "time",               // "time" | "project" | "timeline"
  filters: { projects: new Set(), stages: new Set(), members: new Set() },
  query: "",
  editing: null,              // id of the task open in the editor
  composing: null,            // "stage:<id>" | "project:<id>" whose composer is open
  draft: { title: "", pick: "" }, // composer title and its stage / project choice, kept across re-renders
  creating: null,             // "tile" | "filter": where the new project form is open
  newProject: { name: "", color: "" }, // that form's values, kept across re-renders
  openDone: new Set(),        // project ids whose "Fet" list is unfolded
  fresh: new Set(),           // "kind:id" keys the last fetch added; they pop in once
};

const DAY_W = 32;             // px per timeline day; must match --day-w in planner.css

// ---------- fetch ----------

/** Keys of everything that can pop in, prefixed by kind so ids can't collide. */
const boardKeys = (b) => [...b.tasks.map((t) => `task:${t.id}`), ...b.projects.map((p) => `project:${p.id}`)];

async function fetchBoard() {
  const res = await fetch("/api/board");
  const seen = new Set(boardKeys(state.board));
  state.board = await res.json();
  // Nothing is seen before the first load, so the board doesn't bounce in.
  state.fresh = new Set(seen.size ? boardKeys(state.board).filter((k) => !seen.has(k)) : []);
  render();
  state.fresh.clear();
}

/** Send a mutation, then re-fetch so the UI shows server truth. A rejected
 *  request is surfaced with an alert; the re-fetch reverts the rejected input.
 *  Returns whether the server accepted it. */
async function mutate(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || `Request failed (${res.status})`);
  }
  await fetchBoard();
  return res.ok;
}

function patchTask(id, patch) {
  return mutate("PATCH", `/api/tasks/${id}`, patch);
}

/** Move a task into a column (`{stage}` or `{project}`), above task `before` (or last when null). */
function moveTask(id, target, before) {
  return mutate("POST", `/api/tasks/${id}/move`, { ...target, before });
}

// ---------- helpers ----------

const $ = (id) => document.getElementById(id);

/** Create an element with an optional class and text content. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const byId = (list, id) => list.find((x) => x.id === id);

/** `list` with `id` added, or removed if it was there. */
const toggled = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** The stage a task shows in: "Fet" when done, else the stage it is at. */
const stageOf = (task) => byId(state.board.stages, task.done ? state.board.done_stage : task.stage);

/** Stages a task can be at while open (all but "Fet"). */
const openStages = () => state.board.stages.filter((s) => s.id !== state.board.done_stage);

/** Mark `node` to pop in when the last fetch added it. */
function popIfFresh(node, key) {
  if (state.fresh.has(key)) node.classList.add("is-new");
  return node;
}

function matchesFilters(task) {
  const { projects, stages, members } = state.filters;
  if (state.view === "project") {
    if (stages.size > 0 && !stages.has(stageOf(task).id)) return false;
  } else if (projects.size > 0 && !projects.has(task.project)) return false;
  if (members.size > 0 && !task.members.some((id) => members.has(id))) return false;
  const q = state.query.trim().toLowerCase();
  return !q || `${task.title} ${task.description}`.toLowerCase().includes(q);
}

const shownTasks = () => state.board.tasks.filter(matchesFilters);

// ---------- dates ----------

const toDate = (iso) => new Date(`${iso}T00:00:00`);

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole days from `a` to `b`; rounding absorbs DST shifts. */
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

const fmtDay = (iso) => toDate(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Short date text for a task, or "" when it has no dates. */
function fmtDates(task) {
  const { start_date: s, due_date: d } = task;
  if (s && d) return s === d ? fmtDay(d) : `${fmtDay(s)} – ${fmtDay(d)}`;
  if (d) return `Due ${fmtDay(d)}`;
  if (s) return `From ${fmtDay(s)}`;
  return "";
}

// ---------- small pieces ----------

/** Small caps tag for a project or a stage, in its palette colour. */
function renderTag(item) {
  const node = el("span", "label", item.name);
  node.dataset.color = item.color;
  return node;
}

function renderAvatar(member) {
  const node = el("span", "avatar", member.initials);
  node.dataset.color = member.color;
  node.title = member.name;
  return node;
}

/** Overlapping avatars for the given member ids, or null when there are none. */
function renderAvatars(ids) {
  const members = state.board.members.filter((m) => ids.includes(m.id));
  if (members.length === 0) return null;
  const wrap = el("span", "avatars");
  members.forEach((m) => wrap.appendChild(renderAvatar(m)));
  return wrap;
}

function renderSwatch(color) {
  const node = el("span", "chip__swatch");
  node.dataset.color = color;
  return node;
}

/** Chip button led by a swatch or avatar. `pressed` true/false makes it a toggle. */
function renderChip(lead, text, pressed, onClick) {
  const btn = el("button", "chip");
  btn.type = "button";
  if (pressed !== null) btn.setAttribute("aria-pressed", String(pressed));
  btn.append(lead, text);
  btn.addEventListener("click", onClick);
  return btn;
}

/** One <option> per item, valued by id. */
const renderOptions = (items) =>
  items.map((item) => {
    const opt = el("option", "", item.name);
    opt.value = item.id;
    return opt;
  });

/** A required <select> with a disabled placeholder, the given options and `value` selected. */
function renderSelect(placeholder, items, value) {
  const select = el("select", "input");
  select.required = true;
  select.setAttribute("aria-label", placeholder);
  const empty = el("option", "", placeholder);
  empty.value = "";
  empty.disabled = true;
  select.append(empty, ...renderOptions(items));
  select.value = value;
  return select;
}

// ---------- new project ----------

/** Open the new project form at `where`, preselecting a colour no project uses yet. */
function openCreator(where) {
  const used = new Set(state.board.projects.map((p) => p.color));
  state.creating = where;
  state.newProject = { name: "", color: state.board.colors.find((c) => !used.has(c)) || state.board.colors[0] };
  render();
  const form = document.querySelector(".creator");
  form.querySelector(".input").focus({ preventScroll: true });
  // The board tile can sit past the board's right edge: bring the whole form on screen.
  form.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

/** Inline form for a new project: a name and a palette colour. */
function renderCreator(where) {
  const form = el("form", "creator");
  const name = el("input", "input");
  name.placeholder = "Project name";
  name.setAttribute("aria-label", name.placeholder);
  name.value = state.newProject.name;
  name.addEventListener("input", () => {
    state.newProject.name = name.value;
  });

  const swatches = el("div", "swatches");
  swatches.setAttribute("role", "radiogroup");
  swatches.setAttribute("aria-label", "Colour");
  state.board.colors.forEach((color) => {
    const radio = el("input", "swatch");
    radio.type = "radio";
    radio.name = `${where}-color`;
    radio.value = color;
    radio.dataset.color = color;
    radio.title = color;
    radio.setAttribute("aria-label", color);
    radio.checked = color === state.newProject.color;
    radio.addEventListener("change", () => {
      state.newProject.color = color;
    });
    swatches.appendChild(radio);
  });

  const add = el("button", "btn btn--primary btn--sm", "Add project");
  const cancel = el("button", "btn btn--ghost btn--sm", "Cancel");
  cancel.type = "button";
  const actions = el("div", "creator__actions");
  actions.append(add, cancel);
  form.append(name, swatches, actions);

  const close = () => {
    state.creating = null;
    render();
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.newProject.name.trim()) return;
    // Closed before the re-fetch, so its render puts the new project in place of the form.
    state.creating = null;
    if (!(await mutate("POST", "/api/projects", state.newProject))) {
      // Rejected (e.g. a taken name): bring the form back with what was typed.
      state.creating = where;
      render();
      document.querySelector(".creator .input")?.focus();
    }
  });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  cancel.addEventListener("click", close);
  return form;
}

// ---------- task ----------

/** Task element for the boards. `tag` is its project (Time Board) or stage (Project Board). */
function renderTask(task, tag) {
  const node = popIfFresh(el("article", "task"), `task:${task.id}`);
  node.classList.toggle("is-done", task.done);
  node.dataset.id = task.id;
  node.tabIndex = 0;

  const tick = el("button", "task__tick");
  tick.type = "button";
  tick.setAttribute("aria-pressed", String(task.done));
  tick.setAttribute("aria-label", task.done ? "Mark as not done" : "Mark as done");
  tick.title = tick.getAttribute("aria-label");
  tick.addEventListener("click", (e) => {
    e.stopPropagation();
    patchTask(task.id, { done: !task.done });
  });
  tick.addEventListener("keydown", (e) => e.stopPropagation());
  const top = el("div", "task__top");
  top.append(tick, renderTag(tag));
  node.append(top, el("p", "task__title", task.title));

  const meta = el("div", "task__meta");
  const dates = fmtDates(task);
  if (dates) {
    const span = el("span", "task__dates", dates);
    span.dataset.overdue = String(!task.done && !!task.due_date && toDate(task.due_date) < today());
    meta.appendChild(span);
  }
  if (task.description.trim()) {
    const icon = el("span", "", "≡");
    icon.title = "Has a description";
    meta.appendChild(icon);
  }
  const avatars = renderAvatars(task.members);
  if (avatars) meta.appendChild(avatars);
  node.appendChild(meta);

  node.addEventListener("click", () => openEditor(task.id));
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openEditor(task.id);
  });
  return node;
}

// ---------- boards ----------

function renderBoard() {
  const tasks = shownTasks();
  const { stages, projects, done_stage: done } = state.board;
  if (state.view === "time") {
    $("board").replaceChildren(
      ...stages.map((s) =>
        renderColumn({
          item: s,
          target: { stage: s.id },
          tasks: tasks.filter((t) => (s.id === done ? t.done : !t.done && t.stage === s.id)),
          tagOf: (t) => byId(projects, t.project),
          canAdd: s.id !== done,
        })
      )
    );
  } else {
    $("board").replaceChildren(
      ...projects.map((p) => {
        const mine = tasks.filter((t) => t.project === p.id);
        return renderColumn({
          item: p,
          target: { project: p.id },
          tasks: mine.filter((t) => !t.done),
          doneTasks: mine.filter((t) => t.done),
          tagOf: stageOf,
          canAdd: true,
        });
      }),
      renderProjectAdder()
    );
  }
}

/** One board column: colour head, draggable open tasks, an optional folded
 *  "Fet" list (Project Board) and the add-a-task foot. */
function renderColumn({ item, target, tasks, doneTasks = [], tagOf, canAdd }) {
  const [field, value] = Object.entries(target)[0];
  const node = el("section", "column");
  if (field === "project") popIfFresh(node, `project:${value}`);
  node.dataset.color = item.color;

  const head = el("header", "column__head");
  head.append(
    el("h2", "column__title t-display", item.name),
    el("span", "column__count t-figure", String(tasks.length))
  );

  const list = el("div", "column__tasks");
  list.dataset.field = field;
  list.dataset.value = value;
  tasks.forEach((t) => {
    const task = renderTask(t, tagOf(t));
    task.draggable = true;
    list.appendChild(task);
  });
  node.append(head, list);

  if (doneTasks.length > 0) {
    const fold = el("details", "done-list");
    fold.open = state.openDone.has(value);
    const summary = el("summary", "done-list__summary");
    summary.append(el("span", "", byId(state.board.stages, state.board.done_stage).name), el("span", "t-figure", String(doneTasks.length)));
    const doneList = el("div", "done-list__tasks");
    doneTasks.forEach((t) => doneList.appendChild(renderTask(t, tagOf(t))));
    fold.append(summary, doneList);
    fold.addEventListener("toggle", () => {
      if (fold.open) state.openDone.add(value);
      else state.openDone.delete(value);
    });
    node.appendChild(fold);
  }

  if (canAdd) {
    const key = `${field}:${value}`;
    const foot = el("footer", "column__foot");
    foot.appendChild(state.composing === key ? renderComposer(target) : renderAddButton(key));
    node.appendChild(foot);
  }
  return node;
}

/** Last tile of the Project Board: "+ Add project", or the form for a new one. */
function renderProjectAdder() {
  const tile = el("section", "column-adder");
  if (state.creating === "tile") {
    tile.appendChild(renderCreator("tile"));
  } else {
    const btn = el("button", "btn btn--ghost", "+ Add project");
    btn.addEventListener("click", () => openCreator("tile"));
    tile.appendChild(btn);
  }
  return tile;
}

function renderAddButton(key) {
  const btn = el("button", "btn btn--ghost", "+ Add a task");
  btn.addEventListener("click", () => {
    state.composing = key;
    state.draft = { title: "", pick: "" };
    renderBoard();
    focusComposer();
  });
  return btn;
}

const focusComposer = () => document.querySelector(".composer textarea")?.focus();

/** Inline form for a new task in the column `target`. It asks for what the
 *  column doesn't give: the project on the Time Board, the stage on the Project Board. */
function renderComposer(target) {
  const form = el("form", "composer");
  const input = el("textarea", "input");
  input.rows = 2;
  input.placeholder = "Enter a title for this task…";
  input.value = state.draft.title;
  const pickField = "stage" in target ? "project" : "stage";
  const pick = pickField === "project"
    ? renderSelect("Project…", state.board.projects, state.draft.pick)
    : renderSelect("Stage…", openStages(), state.draft.pick);
  const add = el("button", "btn btn--primary btn--sm", "Add task");
  const cancel = el("button", "btn btn--ghost btn--sm", "Cancel");
  cancel.type = "button";
  const actions = el("div", "composer__actions");
  actions.append(add, cancel);
  form.append(input, pick, actions);

  const close = () => {
    state.composing = null;
    renderBoard();
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    state.draft.title = "";
    // The stage / project choice is kept, so several tasks of one project go in a row.
    await mutate("POST", "/api/tasks", { title, ...target, [pickField]: pick.value });
    focusComposer();
  });
  input.addEventListener("input", () => {
    state.draft.title = input.value;
  });
  pick.addEventListener("change", () => {
    state.draft.pick = pick.value;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();   // an unpicked stage / project stops it with the browser's own prompt
    }
  });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  cancel.addEventListener("click", close);
  return form;
}

// ---------- drag and drop ----------

let drag = null;              // { id, task, slot } while a task is being dragged

function bindDragAndDrop() {
  const root = $("board");

  root.addEventListener("dragstart", (e) => {
    const task = e.target.closest(".task");
    if (!task) return;
    drag = { id: task.dataset.id, task, slot: el("div", "task-slot") };
    drag.slot.style.height = `${task.offsetHeight}px`;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.dataset.id);
    // Collapse the task only after the browser has captured the drag image.
    requestAnimationFrame(() => task.classList.add("is-dragging"));
  });

  // Anywhere over a column counts; the slot goes above the first task whose
  // middle is below the pointer.
  root.addEventListener("dragover", (e) => {
    const list = e.target.closest(".column")?.querySelector(".column__tasks");
    if (!drag || !list) return;
    e.preventDefault();
    const next = [...list.querySelectorAll(".task:not(.is-dragging)")].find((t) => {
      const r = t.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    list.insertBefore(drag.slot, next || null);
  });

  root.addEventListener("drop", (e) => {
    if (!drag || !drag.slot.isConnected) return;
    e.preventDefault();
    let next = drag.slot.nextElementSibling;
    while (next && next.classList.contains("is-dragging")) next = next.nextElementSibling;
    const { field, value } = drag.slot.parentElement.dataset;
    // Put the task in the slot now so it doesn't flash back before the re-fetch.
    drag.slot.replaceWith(drag.task);
    moveTask(drag.id, { [field]: value }, next ? next.dataset.id : null);
  });

  root.addEventListener("dragend", () => {
    if (!drag) return;
    drag.slot.remove();
    drag.task.classList.remove("is-dragging");
    drag = null;
  });
}

// ---------- timeline ----------

function renderTimeline() {
  const tasks = shownTasks();
  const dated = tasks.filter((t) => t.start_date || t.due_date);
  const now = today();

  // Range: the Monday a week before the earliest date (or today), to four weeks past the latest.
  const dates = dated.flatMap((t) => [t.start_date, t.due_date]).filter(Boolean).map(toDate);
  const first = addDays(new Date(Math.min(now, ...dates)), -7);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const days = daysBetween(start, new Date(Math.max(now, ...dates))) + 28;

  const grid = el("div", "tl-grid");
  grid.style.setProperty("--days", days);
  grid.appendChild(renderScale(start, days, now));
  for (const stage of state.board.stages) {
    const rows = dated.filter((t) => stageOf(t) === stage);
    if (rows.length === 0) continue;
    const group = el("div", "tl-row tl-group");
    group.dataset.color = stage.color;
    group.append(el("div", "tl-label t-display", stage.name), el("div", "tl-track"));
    grid.appendChild(group);
    rows.forEach((t) => grid.appendChild(renderTimelineRow(t, stage, start)));
  }
  if (dated.length === 0) {
    grid.appendChild(el("p", "tl-empty", "No tasks have dates yet. Open a task and set a start or due date."));
  }
  const line = el("div", "tl-today");
  line.style.left = `calc(var(--tl-label-w) + ${daysBetween(start, now) * DAY_W + DAY_W / 2 - 1}px)`;
  grid.appendChild(line);

  const scroller = $("timeline");
  const { scrollLeft, scrollTop } = scroller;
  scroller.replaceChildren(grid);
  scroller.scrollLeft = scrollLeft;
  scroller.scrollTop = scrollTop;

  const undated = tasks.filter((t) => !t.start_date && !t.due_date);
  $("unscheduled").replaceChildren(
    ...undated.map((t) => renderChip(renderSwatch(stageOf(t).color), t.title, null, () => openEditor(t.id)))
  );
  $("unscheduled").parentElement.hidden = undated.length === 0;
}

/** Header row: month blocks over day numbers, today's number highlighted. */
function renderScale(start, days, now) {
  const months = el("div", "tl-months");
  const dayRow = el("div", "tl-days");
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    if (i === 0 || d.getDate() === 1) {
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const span = Math.min(daysInMonth - d.getDate() + 1, days - i);
      const month = el("div", "tl-month");
      month.style.width = `${span * DAY_W}px`;
      // A month cut shorter than its name (range edges) would overlap the next: leave it blank.
      if (span >= 5) month.appendChild(el("span", "", d.toLocaleDateString(undefined, { month: "long", year: "numeric" })));
      months.appendChild(month);
    }
    const cell = el("span", "", String(d.getDate()));
    cell.dataset.today = String(daysBetween(d, now) === 0);
    dayRow.appendChild(cell);
  }
  const track = el("div", "tl-track");
  track.append(months, dayRow);
  const row = el("div", "tl-row tl-head");
  row.append(el("div", "tl-label t-label", "Task"), track);
  return row;
}

/** One task on the timeline. A single date shows as a one-day bar. */
function renderTimelineRow(task, stage, start) {
  const label = el("div", "tl-label");
  label.appendChild(el("span", "tl-label__title", task.title));
  const avatars = renderAvatars(task.members);
  if (avatars) label.appendChild(avatars);

  const from = toDate(task.start_date || task.due_date);
  const to = toDate(task.due_date || task.start_date);
  const bar = el("div", "tl-bar");
  bar.dataset.color = stage.color;
  bar.style.left = `${daysBetween(start, from) * DAY_W + 2}px`;
  bar.style.width = `${(daysBetween(from, to) + 1) * DAY_W - 4}px`;
  bar.title = `${task.title} · ${fmtDates(task)}`;
  const track = el("div", "tl-track");
  track.appendChild(bar);

  const row = el("div", "tl-row tl-row--task");
  row.tabIndex = 0;
  row.append(label, track);
  row.addEventListener("click", () => openEditor(task.id));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openEditor(task.id);
  });
  return row;
}

// ---------- editor dialog ----------

const editor = $("editor");

function openEditor(id) {
  state.editing = id;
  fillEditor();
  if (!editor.open) editor.showModal();
}

/** Sync the dialog with the task being edited. Free-text fields are skipped
 *  while focused so a re-fetch never clobbers what the user is typing; the
 *  rest always resync, which also reverts a value the server rejected. */
function fillEditor() {
  const task = byId(state.board.tasks, state.editing);
  if (!task) {
    editor.close();
    return;
  }
  const stage = stageOf(task);
  const setText = (id, value) => {
    if (document.activeElement !== $(id)) $(id).value = value;
  };

  $("edBand").dataset.color = stage.color;
  $("edBandName").textContent = `${stage.name} · ${byId(state.board.projects, task.project).name}`;
  setText("edTitle", task.title);
  $("edStage").replaceChildren(...renderOptions(state.board.stages));
  $("edStage").value = stage.id;
  $("edProject").replaceChildren(...renderOptions(state.board.projects));
  $("edProject").value = task.project;
  $("edStart").value = task.start_date || "";
  $("edDue").value = task.due_date || "";
  $("edStart").max = task.due_date || "";
  $("edDue").min = task.start_date || "";
  setText("edDescription", task.description);

  $("edMembers").replaceChildren(
    ...state.board.members.map((m) =>
      renderChip(renderAvatar(m), m.name, task.members.includes(m.id), () =>
        patchTask(task.id, { members: toggled(task.members, m.id) })
      )
    )
  );
}

function bindEditor() {
  $("edClose").addEventListener("click", () => editor.close());
  editor.addEventListener("click", (e) => {
    if (e.target === editor) editor.close();      // backdrop
  });
  // Escape or the backdrop can close the dialog before a text field's change
  // event fires, so save any pending title / description edit here.
  editor.addEventListener("close", () => {
    const task = byId(state.board.tasks, state.editing);
    state.editing = null;
    if (!task) return;
    const patch = {};
    const title = $("edTitle").value.trim();
    if (title && title !== task.title) patch.title = title;
    if ($("edDescription").value !== task.description) patch.description = $("edDescription").value;
    if (Object.keys(patch).length > 0) patchTask(task.id, patch);
  });

  // A text field's change event can arrive after the dialog closed (and the
  // close handler already saved it), when state.editing is null: skip those.
  const patchEditing = (patch) => state.editing && patchTask(state.editing, patch);
  $("edTitle").addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.target.blur();
  });
  $("edTitle").addEventListener("change", (e) => patchEditing({ title: e.target.value }));
  // Picking "Fet" ticks the task; any other stage unticks it and moves it there.
  $("edStage").addEventListener("change", (e) => {
    const done = e.target.value === state.board.done_stage;
    patchEditing(done ? { done: true } : { stage: e.target.value, done: false });
  });
  $("edProject").addEventListener("change", (e) => patchEditing({ project: e.target.value }));
  $("edStart").addEventListener("change", (e) => patchEditing({ start_date: e.target.value }));
  $("edDue").addEventListener("change", (e) => patchEditing({ due_date: e.target.value }));
  $("edDescription").addEventListener("change", (e) => patchEditing({ description: e.target.value }));

  $("edDelete").addEventListener("click", () => {
    if (!confirm("Delete this task for good?")) return;
    const id = state.editing;
    state.editing = null;     // so closing doesn't save the fields of a deleted task
    editor.close();
    mutate("DELETE", `/api/tasks/${id}`);
  });
}

// ---------- filters ----------

function renderFilters() {
  const f = state.filters;
  if (state.view === "project") {
    $("groupFilterName").textContent = "Status";
    $("groupFilter").replaceChildren(
      ...state.board.stages.map((s) =>
        renderChip(renderSwatch(s.color), s.name, f.stages.has(s.id), () => toggleFilter(f.stages, s.id))
      )
    );
  } else {
    const add = el("button", "chip chip--add", "+");
    add.type = "button";
    add.title = "New project";
    add.setAttribute("aria-label", "New project");
    add.addEventListener("click", () => openCreator("filter"));
    $("groupFilterName").textContent = "Projects";
    $("groupFilter").replaceChildren(
      ...state.board.projects.map((p) =>
        popIfFresh(
          renderChip(renderSwatch(p.color), p.name, f.projects.has(p.id), () => toggleFilter(f.projects, p.id)),
          `project:${p.id}`
        )
      ),
      state.creating === "filter" ? renderCreator("filter") : add
    );
  }
  $("memberFilter").replaceChildren(
    ...state.board.members.map((m) =>
      renderChip(renderAvatar(m), m.name, f.members.has(m.id), () => toggleFilter(f.members, m.id))
    )
  );
  const group = state.view === "project" ? f.stages : f.projects;
  $("clearFilters").hidden = group.size === 0 && f.members.size === 0 && !state.query;
}

function toggleFilter(set, id) {
  if (set.has(id)) set.delete(id);
  else set.add(id);
  render();
}

// ---------- render ----------

function render() {
  document.querySelectorAll(".tab").forEach((t) => {
    if (t.dataset.view === state.view) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  const panel = state.view === "timeline" ? "timeline" : "board";
  document.querySelectorAll(".views > [data-view]").forEach((v) => {
    v.hidden = v.dataset.view !== panel;
  });
  renderFilters();
  if (panel === "board") renderBoard();
  else renderTimeline();
  if (state.editing) fillEditor();
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  state.composing = null;
  state.creating = null;      // its tile or filter row may not exist on the new view
  render();
  if (view === "timeline") {
    // Open with today in the middle of the screen.
    const scroller = $("timeline");
    scroller.scrollLeft = scroller.querySelector(".tl-today").offsetLeft - scroller.clientWidth / 2;
  } else {
    $("board").scrollLeft = 0;
  }
}

// ---------- wiring ----------

function bindTopbar() {
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $("search").addEventListener("input", (e) => {
    state.query = e.target.value;
    render();
  });
  $("clearFilters").addEventListener("click", () => {
    state.filters.projects.clear();
    state.filters.stages.clear();
    state.filters.members.clear();
    state.query = "";
    $("search").value = "";
    render();
  });
}

bindTopbar();
bindDragAndDrop();
bindEditor();
fetchBoard();
