/* Система скинов: загрузка, нормализация, рендер слоёв и предметов. */

const MODULE_ID = "skill-challenge-scales";
export const BUILTIN_ID = "builtin";
const SKINS_DIR = `modules/${MODULE_ID}/skins`;
const STAMP = Date.now(); // чтобы после F5 браузер брал свежие картинки

const route = (p) => foundry.utils.getRoute(p);
const uri = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`;

/* ------------------------------------------------------------ builtin skin */

const GOLD_DEFS = `<linearGradient id="gh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6a2a"/><stop offset=".5" stop-color="#f0d27a"/><stop offset="1" stop-color="#8a6a2a"/></linearGradient>
<linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4d98a"/><stop offset="1" stop-color="#8a6a2a"/></linearGradient>`;
const svg1000 = (inner) => uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><defs>${GOLD_DEFS}</defs>${inner}</svg>`);

const BUILTIN_PAN = (cx, hx) => svg1000(
  `<path d="M${hx} 220L${cx - 120} 520M${hx} 220L${cx + 120} 520" stroke="#c9a24a" stroke-width="4" fill="none"/>
   <path d="M${cx - 120} 520H${cx + 120}A120 70 0 0 1 ${cx - 120} 520Z" fill="url(#gv)" stroke="#6a4a14" stroke-width="3"/>`
);

const DIAMOND = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8f4ff"/><stop offset="1" stop-color="#2aa0ff"/></linearGradient></defs><polygon points="8,4 24,4 30,12 16,29 2,12" fill="url(#d)" stroke="#e8fbff" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 12H30M8 4L12 12L16 4L20 12L24 4M12 12L16 29L20 12" fill="none" stroke="#e8fbff" stroke-opacity=".7" stroke-width="1"/></svg>`);
const SKULL = uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4efe6"/><stop offset="1" stop-color="#b9b0a0"/></linearGradient></defs><path d="M16 2.5C8.8 2.5 4 7.6 4 14c0 3.7 1.7 6.2 4.2 7.6V26c0 1.1.9 2 2 2h2.3v-3h1.9v3h3.2v-3h1.9v3h2.3c1.1 0 2-.9 2-2v-4.4C26.3 20.2 28 17.7 28 14 28 7.6 23.2 2.5 16 2.5z" fill="url(#s)" stroke="#3a2a2a" stroke-width="1"/><circle cx="11" cy="14" r="3.2" fill="#1a1010"/><circle cx="21" cy="14" r="3.2" fill="#1a1010"/><path d="M16 17.5l-2.2 3.8h4.4z" fill="#1a1010"/></svg>`);

const BUILTIN_RAW = {
  name: "Золотые весы (встроенный)",
  canvas: [1000, 800],
  layers: {
    base: svg1000(`<rect x="488" y="200" width="24" height="520" rx="10" fill="url(#gh)"/><rect x="370" y="700" width="260" height="70" rx="24" fill="url(#gv)" stroke="#6a4a14" stroke-width="3"/>`),
    panLeft: BUILTIN_PAN(150, 150),
    panRight: BUILTIN_PAN(850, 850),
    beam: svg1000(`<rect x="150" y="190" width="700" height="20" rx="10" fill="url(#gv)" stroke="#6a4a14" stroke-width="3"/><circle cx="150" cy="220" r="10" fill="#f0d27a" stroke="#6a4a14" stroke-width="3"/><circle cx="850" cy="220" r="10" fill="#f0d27a" stroke="#6a4a14" stroke-width="3"/>`),
    hub: svg1000(`<circle cx="500" cy="200" r="22" fill="url(#gv)" stroke="#6a4a14" stroke-width="3"/>`)
  },
  pivot: [500, 200],
  hangLeft: [150, 220],
  hangRight: [850, 220],
  landLeft: { x: 50, y: 440, w: 200, h: 80 },
  landRight: { x: 750, y: 440, w: 200, h: 80 },
  maxTilt: 14,
  itemsLayer: "front", // у встроенной чаши непрозрачное дно, предметы должны быть поверх
  success: { files: [DIAMOND], size: 56 },
  failure: { files: [SKULL], size: 56 }
};

/* ------------------------------------------------------------ loading */

// Порядок слоёв снизу вверх. Чаши лежат ПОД коромыслом и осью (hub).
const LAYER_KEYS = ["background", "base", "panLeft", "panRight", "beam", "hub", "front"];

function normalize(raw, id, isBuiltin) {
  const [W, H] = Array.isArray(raw.canvas) ? raw.canvas.map(Number) : [1000, 800];
  const res = (f) => {
    if (!f) return null;
    if (isBuiltin || /^(data:|https?:|\/)/.test(f)) return f;
    return `${route(`${id}/${f}`)}?v=${STAMP}`;
  };
  const pt = (v, d) => (Array.isArray(v) && v.length === 2 ? v.map(Number) : d);
  const zone = (z, d) => ({ ...d, ...(z ?? {}) });
  const L = raw.layers ?? {};
  const fb = isBuiltin ? null : BUILTIN_RAW;
  const kind = (k, def) => {
    const files = (k?.files ?? []).map(res).filter(Boolean);
    return { files: files.length ? files : (fb ? fb[def].files : []), size: Number(k?.size) || 56 };
  };
  return {
    id,
    name: raw.name ?? id,
    W,
    H,
    layers: Object.fromEntries(LAYER_KEYS.map((k) => [k, res(L[k])])),
    pivot: pt(raw.pivot, [W / 2, 200]),
    hangLeft: pt(raw.hangLeft, [150, 220]),
    hangRight: pt(raw.hangRight, [W - 150, 220]),
    landLeft: zone(raw.landLeft, { x: 50, y: 440, w: 200, h: 80 }),
    landRight: zone(raw.landRight, { x: W - 250, y: 440, w: 200, h: 80 }),
    maxTilt: Number(raw.maxTilt) || 14,
    counterOffset: Number(raw.counterOffset) || 100,
    // "back": предметы под всеми слоями скина (кроме background); "front": поверх чаши
    itemsLayer: raw.itemsLayer === "front" ? "front" : "back",
    success: kind(raw.success, "success"),
    failure: kind(raw.failure, "failure")
  };
}

async function fetchSkinJSON(dir) {
  const r = await fetch(route(`${dir}/skin.json`) + `?v=${Date.now()}`);
  if (!r.ok) throw new Error(`${dir}/skin.json: HTTP ${r.status}`);
  return r.json();
}

export async function loadSkin(id) {
  if (!id || id === BUILTIN_ID) return normalize(BUILTIN_RAW, BUILTIN_ID, true);
  try {
    return normalize(await fetchSkinJSON(id), id, false);
  } catch (e) {
    console.warn(`${MODULE_ID} | не удалось загрузить скин "${id}", использую встроенный`, e);
    return normalize(BUILTIN_RAW, BUILTIN_ID, true);
  }
}

async function browseDirs(path) {
  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  try {
    const r = await FP.browse("data", path);
    return r?.dirs ?? [];
  } catch {
    return [];
  }
}

/** Список скинов для выбора (нужны права на просмотр файлов, то есть мастер). */
export async function listSkins(extraPath) {
  const out = [{ id: BUILTIN_ID, name: game.i18n.localize("SCS.BuiltinSkin") }];
  for (const root of [SKINS_DIR, extraPath].filter(Boolean)) {
    for (const dir of await browseDirs(root)) {
      let label = dir.split("/").pop();
      try { label = decodeURIComponent(label); } catch { /* оставляем как есть */ }
      if (label.startsWith("_")) continue;
      try {
        const raw = await fetchSkinJSON(dir);
        out.push({ id: dir, name: raw.name ?? label });
      } catch { /* папка без skin.json */ }
    }
  }
  return out;
}

/* ------------------------------------------------------------ rendering */

const layerImg = (src, cls = "") =>
  src ? `<img class="scs-layer ${cls}" src="${esc(src)}" draggable="false" onerror="this.style.visibility='hidden'">` : "";

/** Каркас весов. Чаши под коромыслом и осью. Элементы itemsS/F и countS/F заполняет update(). */
export function stageHTML(skin) {
  const { W, H, layers } = skin;
  const origin = (p) => `${pct(p[0], W)} ${pct(p[1], H)}`;
  // Обёртка, которая двигается вместе с чашей: наклон вокруг оси коромысла, выравнивание вокруг точки подвеса.
  const follow = (hang, inner) => `
    <div class="scs-pan-o" style="transform-origin:${origin(skin.pivot)}">
      <div class="scs-pan-i" style="transform-origin:${origin(hang)}">${inner}</div>
    </div>`;
  const items = (side) => `<div class="scs-items" data-el="items${side}"></div>`;
  const back = skin.itemsLayer === "back";
  const pan = (side, src, hang, land) => follow(hang, `
    ${layerImg(src)}
    ${back ? "" : items(side)}
    <div class="scs-count" data-el="count${side}" style="left:${pct(land.x + land.w / 2, W)};top:${pct(land.y + land.h + skin.counterOffset, H)}"></div>`);
  return `<div class="scs-stage" style="aspect-ratio:${W}/${H}">
    ${layerImg(layers.background)}
    ${back ? follow(skin.hangLeft, items("S")) + follow(skin.hangRight, items("F")) : ""}
    ${layerImg(layers.base)}
    ${pan("S", layers.panLeft, skin.hangLeft, skin.landLeft)}
    ${pan("F", layers.panRight, skin.hangRight, skin.landRight)}
    <div class="scs-beam-wrap" style="transform-origin:${origin(skin.pivot)}">${layerImg(layers.beam)}</div>
    ${layerImg(layers.hub)}
    ${layerImg(layers.front)}
  </div>`;
}

// Детерминированный «рандом», чтобы у всех клиентов куча выглядела одинаково и не прыгала.
const rnd = (i, salt) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Предметы на чаше. kind: "success" (левая чаша) или "failure" (правая). */
export function itemsHTML(skin, kind, count, prevCount) {
  const cfg = skin[kind];
  if (!cfg.files.length) return "";
  const land = kind === "success" ? skin.landLeft : skin.landRight;
  const salt = kind === "success" ? 1 : 2;
  const s = cfg.size;
  const perRow = Math.max(1, Math.floor(land.w / (s * 0.8)));
  let html = "";
  for (let i = 0; i < Math.min(count, 60); i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = land.x + ((col + 0.5) * land.w) / perRow + (rnd(i, salt) - 0.5) * s * 0.25;
    const y = land.y + land.h - row * s * 0.62 + (rnd(i, salt + 10) - 0.5) * s * 0.1;
    const file = cfg.files[Math.floor(rnd(i, salt + 20) * cfg.files.length)];
    const rot = (rnd(i, salt + 30) - 0.5) * 30;
    const pop = prevCount != null && i >= prevCount;
    html += `<span class="scs-item" style="left:${pct(x, skin.W)};top:${pct(y, skin.H)};width:${pct(s, skin.W)}"><span class="scs-fall${pop ? " pop" : ""}"><img src="${esc(file)}" style="transform:rotate(${rot.toFixed(1)}deg)" draggable="false" onerror="this.style.visibility='hidden'"></span></span>`;
  }
  return html;
}
