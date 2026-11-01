import { BUILTIN_ID, loadSkin, listSkins, stageHTML, itemsHTML } from "./skins.mjs";

const MODULE_ID = "skill-challenge-scales";
const SOCKET = `module.${MODULE_ID}`;
const MAX_ICONS = 12;
const MAX_LOG = 8;

const loc = (key, data) => game.i18n.format(`SCS.${key}`, data ?? {});
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const DEFAULT_STATE = () => ({
  active: false,
  title: "",
  targetSuccesses: 3,
  targetFailures: 3,
  successes: 0,
  failures: 0,
  outcome: null,
  check: null,
  log: []
});

const ICON_DIAMOND = `<svg viewBox="0 0 32 32" aria-hidden="true"><polygon points="8,4 24,4 30,12 16,29 2,12" fill="url(#scs-g-diamond)" stroke="#e8fbff" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 12H30M8 4L12 12L16 4L20 12L24 4M12 12L16 29L20 12" fill="none" stroke="#e8fbff" stroke-opacity=".7" stroke-width="1"/></svg>`;
const ICON_SKULL = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5C8.8 2.5 4 7.6 4 14c0 3.7 1.7 6.2 4.2 7.6V26c0 1.1.9 2 2 2h2.3v-3h1.9v3h3.2v-3h1.9v3h2.3c1.1 0 2-.9 2-2v-4.4C26.3 20.2 28 17.7 28 14 28 7.6 23.2 2.5 16 2.5z" fill="url(#scs-g-skull)" stroke="#3a2a2a" stroke-width="1"/><circle cx="11" cy="14" r="3.2" fill="#1a1010"/><circle cx="21" cy="14" r="3.2" fill="#1a1010"/><path d="M16 17.5l-2.2 3.8h4.4z" fill="#1a1010"/></svg>`;

let root = null;
let prev = null;
let skin = null;
let skinLoadedFor = null;
let skinLoading = null;
let stageFor = null;
let queue = Promise.resolve();
const localRolled = new Set();

/* ---------------------------------------------------------------- state */

function getAll() {
  return game.settings.get(MODULE_ID, "challenges") ?? {};
}

function getState(sceneId) {
  const saved = getAll()[sceneId] ?? {};
  return Object.assign(DEFAULT_STATE(), foundry.utils.deepClone(saved));
}

function recalc(s) {
  if (s.successes >= s.targetSuccesses) s.outcome = "success";
  else if (s.failures >= s.targetFailures) s.outcome = "failure";
  else s.outcome = null;
}

function mutate(sceneId, fn) {
  queue = queue
    .then(async () => {
      const all = foundry.utils.deepClone(getAll());
      const s = Object.assign(DEFAULT_STATE(), all[sceneId] ?? {});
      const res = fn(s);
      all[sceneId] = s;
      await game.settings.set(MODULE_ID, "challenges", all);
      return res;
    })
    .catch((e) => console.error(MODULE_ID, e));
  return queue;
}

function announce(s, outcome) {
  const title = s.title || loc("DefaultTitle");
  const text = outcome === "success" ? loc("VictoryChat", { title: esc(title) }) : loc("DefeatChat", { title: esc(title) });
  return ChatMessage.create({
    content: `<div class="scs-card ${outcome}"><div class="scs-card-title">⚖ ${esc(title)}</div><p>${text}</p></div>`
  });
}

/* ---------------------------------------------------------------- results */

async function applyResult(data) {
  const res = await mutate(data.sceneId, (s) => {
    if (!s.active || s.outcome || !s.check || s.check.id !== data.checkId) return null;
    if (s.check.rolled.includes(data.actorId)) return null;
    s.check.rolled.push(data.actorId);
    const success = data.total >= s.check.dc;
    if (success) s.successes++;
    else s.failures++;
    s.log.unshift({
      id: foundry.utils.randomID(),
      actorName: data.actorName,
      userName: data.userName,
      label: s.check.label,
      dc: s.check.dc,
      hideDC: !!s.check.hideDC,
      total: data.total,
      success
    });
    s.log = s.log.slice(0, MAX_LOG);
    recalc(s);
    return s.outcome ? { s: foundry.utils.deepClone(s), outcome: s.outcome } : null;
  });
  if (res?.outcome) announce(res.s, res.outcome);
}

function submitResult(data) {
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn(loc("NoGM"));
    return;
  }
  if (gm.isSelf) applyResult(data);
  else game.socket.emit(SOCKET, { action: "result", ...data });
}

/* ---------------------------------------------------------------- rolling */

async function rollForActor(actor, check) {
  const target = check.hideDC ? undefined : check.dc;
  const v5 = typeof actor.rollAbilityCheck === "function";
  let rolls;
  if (check.type === "skill") {
    rolls = v5
      ? await actor.rollSkill({ skill: check.key, target }, {}, {})
      : await actor.rollSkill(check.key, { targetValue: target });
  } else {
    rolls = v5
      ? await actor.rollAbilityCheck({ ability: check.key, target }, {}, {})
      : await actor.rollAbilityTest(check.key, { targetValue: target });
  }
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  return roll?.total ?? null;
}

async function onRollClick(checkId, sceneId) {
  const st = getState(sceneId);
  const check = st.check;
  if (!st.active || !check || check.id !== checkId || st.outcome) {
    ui.notifications.warn(loc("Expired"));
    return;
  }
  const actor = canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!actor) {
    ui.notifications.warn(loc("NoActor"));
    return;
  }
  const key = `${checkId}:${actor.id}`;
  if (check.rolled.includes(actor.id) || localRolled.has(key)) {
    ui.notifications.warn(loc("AlreadyRolled"));
    return;
  }
  localRolled.add(key);
  let total = null;
  try {
    total = await rollForActor(actor, check);
  } catch (e) {
    console.error(MODULE_ID, e);
  }
  if (total == null) {
    localRolled.delete(key);
    return;
  }
  submitResult({
    sceneId,
    checkId,
    actorId: actor.id,
    actorName: actor.name,
    userName: game.user.name,
    total
  });
}

/* ---------------------------------------------------------------- GM actions */

async function toggleChallenge() {
  if (!game.user.isGM) return;
  const scene = canvas.scene;
  if (!scene) return;
  await mutate(scene.id, (s) => {
    s.active = !s.active;
    if (s.active && !s.title) s.title = scene.name;
  });
}

async function sendCheck() {
  const scene = canvas.scene;
  if (!scene) return;
  const sel = root.querySelector('[data-field="check"]').value;
  const [type, key] = sel.split(":");
  const cfg = CONFIG.DND5E;
  const label = game.i18n.localize((type === "skill" ? cfg.skills[key]?.label : cfg.abilities[key]?.label) ?? key);
  const dc = Number(root.querySelector('[data-field="dc"]').value) || 10;
  const hideDC = root.querySelector('[data-field="hideDC"]').checked;
  const check = { id: foundry.utils.randomID(), type, key, label, dc, hideDC, rolled: [] };
  await mutate(scene.id, (s) => {
    s.active = true;
    s.check = check;
  });
  const title = getState(scene.id).title || loc("DefaultTitle");
  const dcText = hideDC ? loc("DCHidden") : `${loc("DC")} ${dc}`;
  await ChatMessage.create({
    content: `<div class="scs-card">
      <div class="scs-card-title">⚖ ${esc(title)}</div>
      <div class="scs-card-line"><b>${esc(label)}</b> · ${esc(dcText)}</div>
      <p class="scs-card-hint">${loc("CardHint")}</p>
      <button type="button" class="scs-roll"><i class="fa-solid fa-dice-d20"></i> ${loc("Roll")}</button>
    </div>`,
    flags: { [MODULE_ID]: { checkId: check.id, sceneId: scene.id } }
  });
}

function readGMFields() {
  const num = (f, d) => Math.max(1, Math.min(MAX_ICONS, Math.floor(Number(root.querySelector(`[data-field="${f}"]`).value) || d)));
  return {
    title: root.querySelector('[data-field="title"]').value.trim(),
    tS: num("tS", 3),
    tF: num("tF", 3)
  };
}

async function handleAction(action) {
  const scene = canvas.scene;
  if (!scene) return;
  const sid = scene.id;
  const adjust = async (field, delta) => {
    const res = await mutate(sid, (s) => {
      const before = s.outcome;
      s[field] = Math.max(0, s[field] + delta);
      recalc(s);
      return !before && s.outcome ? { s: foundry.utils.deepClone(s), outcome: s.outcome } : null;
    });
    if (res?.outcome) announce(res.s, res.outcome);
  };
  switch (action) {
    case "collapse":
      root.classList.toggle("scs-collapsed");
      break;
    case "toggle-gm": {
      const gm = root.querySelector('[data-el="gm"]');
      gm.hidden = !gm.hidden;
      if (!gm.hidden) refreshSkinList();
      break;
    }
    case "roll": {
      const st = getState(sid);
      if (st.check) onRollClick(st.check.id, sid);
      break;
    }
    case "apply": {
      const f = readGMFields();
      await mutate(sid, (s) => {
        s.title = f.title;
        s.targetSuccesses = f.tS;
        s.targetFailures = f.tF;
        recalc(s);
      });
      break;
    }
    case "reset":
      await mutate(sid, (s) => {
        s.successes = 0;
        s.failures = 0;
        s.outcome = null;
        s.check = null;
        s.log = [];
      });
      break;
    case "sPlus": return adjust("successes", 1);
    case "sMinus": return adjust("successes", -1);
    case "fPlus": return adjust("failures", 1);
    case "fMinus": return adjust("failures", -1);
    case "send":
      return sendCheck();
    case "close":
      await mutate(sid, (s) => { s.active = false; });
      break;
  }
}

/* ---------------------------------------------------------------- UI */

function selectOptions() {
  const cfg = CONFIG.DND5E;
  const abilities = Object.entries(cfg.abilities ?? {})
    .map(([k, v]) => `<option value="ability:${k}">${esc(game.i18n.localize(v.label))}</option>`)
    .join("");
  const skills = Object.entries(cfg.skills ?? {})
    .map(([k, v]) => `<option value="skill:${k}">${esc(game.i18n.localize(v.label))}</option>`)
    .join("");
  return `<optgroup label="${loc("Skills")}">${skills}</optgroup><optgroup label="${loc("Abilities")}">${abilities}</optgroup>`;
}

function template(isGM) {
  return `
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="scs-g-diamond" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8f4ff"/><stop offset="1" stop-color="#2aa0ff"/></linearGradient>
    <linearGradient id="scs-g-skull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4efe6"/><stop offset="1" stop-color="#b9b0a0"/></linearGradient>
  </defs></svg>
  <div class="scs-box">
    <div class="scs-head">
      <span class="scs-title" data-el="title"></span>
      <span class="scs-head-btns">
        ${isGM ? `<button type="button" data-action="toggle-gm" title="${loc("Controls")}"><i class="fa-solid fa-gear"></i></button>` : ""}
        <button type="button" data-action="collapse" title="${loc("Collapse")}"><i class="fa-solid fa-chevron-up"></i></button>
      </span>
    </div>
    <div class="scs-body">
      <div class="scs-scale">
        <div data-el="stage"></div>
        <div class="scs-outcome" data-el="outcome" hidden></div>
      </div>
      <div class="scs-check" data-el="check"></div>
      <ul class="scs-log" data-el="log"></ul>
      ${isGM ? `
      <div class="scs-gm" data-el="gm" hidden>
        <label>${loc("Skin")}<select data-field="skin"></select></label>
        <label>${loc("Title")}<input data-field="title" type="text"></label>
        <div class="scs-row">
          <label>${loc("Needed")}<input data-field="tS" type="number" min="1" max="${MAX_ICONS}"></label>
          <label>${loc("Allowed")}<input data-field="tF" type="number" min="1" max="${MAX_ICONS}"></label>
          <button type="button" data-action="apply">${loc("Apply")}</button>
        </div>
        <div class="scs-row adjust">
          <span class="scs-mini">${ICON_DIAMOND}</span>
          <button type="button" data-action="sMinus">−</button><button type="button" data-action="sPlus">+</button>
          <span class="scs-mini">${ICON_SKULL}</span>
          <button type="button" data-action="fMinus">−</button><button type="button" data-action="fPlus">+</button>
          <button type="button" data-action="reset">${loc("Reset")}</button>
        </div>
        <hr>
        <div class="scs-row">
          <label class="grow">${loc("Check")}<select data-field="check">${selectOptions()}</select></label>
          <label>${loc("DC")}<input data-field="dc" type="number" value="15"></label>
        </div>
        <label class="chk"><input type="checkbox" data-field="hideDC"> ${loc("HideDC")}</label>
        <div class="scs-row">
          <button type="button" data-action="send"><i class="fa-solid fa-paper-plane"></i> ${loc("Send")}</button>
          <button type="button" data-action="close">${loc("Close")}</button>
        </div>
      </div>` : ""}
    </div>
  </div>`;
}

function buildUI() {
  root = document.createElement("div");
  root.id = "scs-root";
  root.classList.add("scs-hidden");
  root.innerHTML = template(game.user.isGM);
  document.body.append(root);
  applySize();
  root.addEventListener("change", (ev) => {
    if (ev.target.dataset?.field === "skin") game.settings.set(MODULE_ID, "skin", ev.target.value);
  });
  root.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (btn) handleAction(btn.dataset.action);
  });
}

function applySize() {
  root?.style.setProperty("--scs-size", (game.settings.get(MODULE_ID, "size") || 100) / 100);
}

async function refreshSkinList() {
  if (!game.user.isGM || !root) return;
  const sel = root.querySelector('[data-field="skin"]');
  if (!sel) return;
  const list = await listSkins(game.settings.get(MODULE_ID, "extraSkinsPath"));
  const cur = game.settings.get(MODULE_ID, "skin") || BUILTIN_ID;
  if (!list.some((x) => x.id === cur)) list.push({ id: cur, name: cur });
  sel.innerHTML = list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
  sel.value = cur;
}

function setField(name, value) {
  const el = root.querySelector(`[data-field="${name}"]`);
  if (el && document.activeElement !== el) el.value = value;
}

function update() {
  if (!root) return;
  const scene = canvas?.scene;
  const s = scene ? getState(scene.id) : null;
  const visible = !!s?.active;
  root.classList.toggle("scs-hidden", !visible);
  if (!visible) {
    prev = null;
    return;
  }
  const q = (el) => root.querySelector(`[data-el="${el}"]`);
  const isGM = game.user.isGM;
  const showTotals = game.settings.get(MODULE_ID, "showTotals");

  q("title").textContent = s.title || loc("DefaultTitle");

  const wanted = game.settings.get(MODULE_ID, "skin") || BUILTIN_ID;
  if (!skin || skinLoadedFor !== wanted) {
    if (skinLoading !== wanted) {
      skinLoading = wanted;
      loadSkin(wanted).then((sk) => {
        skin = sk;
        skinLoadedFor = wanted;
        skinLoading = null;
        update();
      });
    }
    if (!skin) return;
  }
  if (stageFor !== skin) {
    q("stage").innerHTML = stageHTML(skin);
    stageFor = skin;
    prev = null;
  }

  const max = Math.max(s.targetSuccesses, s.targetFailures, 1);
  const tilt = Math.max(-1, Math.min(1, (s.failures - s.successes) / max)) * skin.maxTilt;
  root.style.setProperty("--tilt", tilt);

  q("itemsS").innerHTML = itemsHTML(skin, "success", s.successes, prev?.successes);
  q("itemsF").innerHTML = itemsHTML(skin, "failure", s.failures, prev?.failures);
  q("countS").textContent = `${s.successes} / ${s.targetSuccesses}`;
  q("countF").textContent = `${s.failures} / ${s.targetFailures}`;
  prev = { successes: s.successes, failures: s.failures };

  const out = q("outcome");
  out.hidden = !s.outcome;
  out.className = `scs-outcome ${s.outcome ?? ""}`;
  out.textContent = s.outcome === "success" ? loc("Victory") : s.outcome === "failure" ? loc("Defeat") : "";

  const chk = q("check");
  if (s.outcome) {
    chk.innerHTML = "";
  } else if (s.check) {
    const hideDC = !isGM && s.check.hideDC;
    const dcText = hideDC ? loc("DCHidden") : `${loc("DC")} ${s.check.dc}`;
    chk.innerHTML = `<span class="scs-check-label">${loc("CurrentCheck")}:</span> <b>${esc(s.check.label)}</b> · ${esc(dcText)}
      <button type="button" data-action="roll"><i class="fa-solid fa-dice-d20"></i> ${loc("Roll")}</button>`;
  } else {
    chk.innerHTML = `<span class="scs-check-label">${loc("NoCheck")}</span>`;
  }

  q("log").innerHTML = s.log
    .map((e) => {
      const hide = !isGM && (e.hideDC || !showTotals);
      const num = hide ? "" : `${e.total} / ${e.dc}`;
      return `<li class="${e.success ? "ok" : "bad"}"><span class="who">${esc(e.actorName)}</span><span class="what">${esc(e.label)}</span><span class="num">${num}</span><i>${e.success ? "✔" : "✘"}</i></li>`;
    })
    .join("");

  if (isGM) {
    setField("title", s.title);
    setField("tS", s.targetSuccesses);
    setField("tF", s.targetFailures);
  }
}

/* ---------------------------------------------------------------- hooks */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "challenges", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => update()
  });

  game.settings.register(MODULE_ID, "skin", {
    scope: "world",
    config: false,
    type: String,
    default: BUILTIN_ID,
    onChange: () => update()
  });

  game.settings.register(MODULE_ID, "extraSkinsPath", {
    name: "SCS.SettingSkinsPath",
    hint: "SCS.SettingSkinsPathHint",
    scope: "world",
    config: true,
    type: String,
    default: "skill-challenge-skins",
    onChange: () => refreshSkinList()
  });

  game.settings.register(MODULE_ID, "size", {
    name: "SCS.SettingSize",
    hint: "SCS.SettingSizeHint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 50, max: 160, step: 5 },
    default: 100,
    onChange: () => applySize()
  });

  game.settings.register(MODULE_ID, "showTotals", {
    name: "SCS.SettingShowTotals",
    hint: "SCS.SettingShowTotalsHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => update()
  });

  game.keybindings.register(MODULE_ID, "toggle", {
    name: "SCS.KeyToggle",
    editable: [{ key: "KeyK", modifiers: ["Alt"] }],
    restricted: true,
    onDown: () => {
      toggleChallenge();
      return true;
    }
  });
});

Hooks.once("ready", () => {
  buildUI();
  game.socket.on(SOCKET, (data) => {
    if (data?.action === "result" && game.users.activeGM?.isSelf) applyResult(data);
  });
  game.modules.get(MODULE_ID).api = { toggle: toggleChallenge, update };
  refreshSkinList();
  update();
});

Hooks.on("canvasReady", () => {
  prev = null;
  update();
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const group = controls.tokens ?? controls.token;
  if (!group?.tools) return;
  group.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "SCS.ToolTitle",
    icon: "fa-solid fa-scale-balanced",
    order: 99,
    button: true,
    visible: true,
    onChange: () => toggleChallenge()
  };
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  const f = message.flags?.[MODULE_ID];
  if (!f?.checkId) return;
  html.querySelector(".scs-roll")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    onRollClick(f.checkId, f.sceneId);
  });
});
