/* ============================================================
   State
   ============================================================ */
const STORAGE_KEY = 'capygo_player_state_v1';

function defaultState() {
  return {
    collectibleOwned: {},   // itemName -> bool
    collectibleStars: {},   // itemName -> number of stars, 0-10
    relicOwned: {},         // relicName -> bool (keyed by name, not id — ids can be blank/duplicate in source data)
    relicStars: {},         // relicName -> 0-10
    mountState: {},         // idx -> { owned, stars(0-5), awaken(0-10) }
    artifactState: {},      // idx -> { owned, stars(0-5), awaken(0-10) }
    fashionLevel: 0,
    homestead: {},           // buildingId -> level (0 = not owned)
    petState: {},           // idx -> { owned, battleLv(1-5), awaken(0-10) }
    equipment: {},           // slotId -> { itemName, quality, surpass, arcana, psionics[4], gems[5] }
    petSlots: [
      { itemName: '', arcana: -1, level: 0, armament: '', armamentLevel: 1, skills: [{ stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }] },
      { itemName: '', arcana: -1, level: 0, armament: '', armamentLevel: 1, skills: [{ stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }] },
      { itemName: '', arcana: -1, level: 0, armament: '', armamentLevel: 1, skills: [{ stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }] },
    ],
    mountSlots: [{ itemIdx: null }, { itemIdx: null }, { itemIdx: null }], // 3 deployed — awaken skill each
    mountMainSlot: { itemIdx: null }, // 1 main — star skill
    artifactSlots: [{ itemIdx: null }, { itemIdx: null }, { itemIdx: null }],
    artifactMainSlot: { itemIdx: null },
    relicSlots: { totem1: null, totem2: null, core: null, guardian: null }, // relic name per slot
    adventurerSlot: { name: '', stars: 0 },
    heroSlots: [{ name: '', quality: '', polarization: 0 }, { name: '', quality: '', polarization: 0 }],
    brandSlots: [{ name: '', quality: '', polarization: 0 }, { name: '', quality: '', polarization: 0 }, { name: '', quality: '', polarization: 0 }, { name: '', quality: '', polarization: 0 }],
    inheritance: {
      activeTree: 'sk',       // which tree is deployed in battle — sk/kn/rn/gh only, Dragon isn't selectable as active
      viewingTree: 'sk',      // which tree's tab is currently open for viewing/editing (independent of activeTree)
      progress: { sk: {}, kn: {}, rn: {}, gh: {}, dr: {} }, // treeKey -> nodeId -> invested points
    },
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    console.warn('Could not load saved state, starting fresh.', e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save state.', e);
  }
}

function getMountOrArtifactState(bucket, idx) {
  if (!state[bucket][idx]) {
    state[bucket][idx] = { owned: false, stars: 0, awaken: 0 };
  }
  return state[bucket][idx];
}

function getPetState(idx) {
  if (!state.petState[idx]) {
    state.petState[idx] = { owned: false, battleLv: 1, awaken: 0 };
  }
  return state.petState[idx];
}

/* ============================================================
   Small DOM helpers
   ============================================================ */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

const STAT_LABELS = {
  hp_pct: 'HP%', hp: 'HP', atk_pct: 'ATK%', atk: 'ATK', def_pct: 'DEF%', def: 'DEF',
  tenacity: 'Tenacity', armor_break: 'Armor Break', penetration: 'Penetration',
  block: 'Block', suppression: 'Suppression', ignore_suppression: 'Ignore Suppression',
  crit_rate: 'Crit Rate%', crit_dmg: 'Crit DMG%',
};
function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function itemImagePath(kind, item) {
  return `assets/images/${kind}/${slugify(item.n)}.webp`;
}

/* Small inline thumbnail (icon-sized, sits left of the item name) with
   graceful fallback: shows a dimmed placeholder mark until (or unless) the
   real image file exists at assets/images/<kind>/<slug>.webp. Nothing breaks
   for items without art yet — just add the file later. */
function renderThumb(kind, item) {
  const thumb = el('div', { class: 'item-thumb-inline' });
  thumb.appendChild(el('span', { class: 'thumb-placeholder-inline' }, '◈'));
  thumb.appendChild(el('img', {
    src: itemImagePath(kind, item),
    alt: item.n,
    loading: 'lazy',
    onerror: (e) => { e.target.style.display = 'none'; },
  }));
  return thumb;
}

function renderOwnedBadge(isOwned, onToggle) {
  return el('button', {
    type: 'button',
    class: 'owned-badge' + (isOwned ? ' owned' : ''),
    onclick: () => onToggle(!isOwned),
  }, el('span', { class: 'owned-label' }, isOwned ? 'Owned' : 'Not Owned'));
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

let editingStepperKey = null;

/* Shared stepper: −/+ buttons for incremental adjustment, plus click-to-edit
   on the number itself for typing an exact value directly. format() controls
   how the value displays (e.g. "3★", "A5") when not being edited. */
function renderStepper(key, value, min, max, onChange, format) {
  format = format || (v => String(v));

  if (editingStepperKey === key) {
    const input = el('input', {
      type: 'number', class: 'stepper-input',
      value: String(value), min: String(min), max: String(max),
      'data-stepper-key': key,
      onblur: (e) => {
        const num = parseInt(e.target.value, 10);
        editingStepperKey = null;
        if (!isNaN(num)) onChange(clamp(num, min, max));
        else render();
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') { editingStepperKey = null; render(); }
      },
    });
    return el('div', { class: 'stepper' }, [
      el('button', { onclick: () => onChange(clamp(value - 1, min, max)) }, '−'),
      input,
      el('button', { onclick: () => onChange(clamp(value + 1, min, max)) }, '+'),
    ]);
  }

  return el('div', { class: 'stepper' }, [
    el('button', { onclick: () => onChange(clamp(value - 1, min, max)) }, '−'),
    el('span', {
      class: 'val val-editable',
      onclick: () => { editingStepperKey = key; render(); },
    }, format(value)),
    el('button', { onclick: () => onChange(clamp(value + 1, min, max)) }, '+'),
  ]);
}

function focusActiveStepperInput() {
  if (!editingStepperKey) return;
  const input = document.querySelector(`[data-stepper-key="${CSS.escape(editingStepperKey)}"]`);
  if (input) { input.focus(); input.select(); }
}

function statLabel(key) {
  const base = key.replace(/_pct$/, '');
  return STAT_LABELS[base] || base.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* Wrap [ Skill Name ] tags so they never break mid-bracket — if they don't
   fit on the current line, the whole tag moves down as one unit instead. */
function renderTextWithSkillTags(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const regex = /\[\s*[^[\]]+?\s*\]/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    // Each [ Skill Name ] reference gets its own line rather than flowing
    // inline with the surrounding prose — easier to spot at a glance, and
    // the nowrap on .skill-tag means the bracket text itself never splits
    // across two lines once it's isolated like this.
    frag.appendChild(el('br'));
    frag.appendChild(el('span', { class: 'skill-tag' }, match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  return frag;
}

/* Stat entries as DOM nodes with the value (the part that changes as you
   move the star/awaken steppers) highlighted in the accent color.
   showSign: prefix positive deltas with '+' (for artifact deltas, not for
   relic absolute stat previews). */
function formatStatBlockNodes(stats, showSign) {
  const entries = Object.entries(stats).filter(([k]) => k !== '_unparsed');
  const frag = document.createDocumentFragment();
  if (!entries.length) { frag.appendChild(document.createTextNode('—')); return frag; }
  entries.forEach(([k, v], i) => {
    if (i > 0) frag.appendChild(document.createTextNode(' · '));
    frag.appendChild(document.createTextNode(statLabel(k) + ' '));
    const sign = showSign && v > 0 ? '+' : '';
    const valText = `${sign}${v}${k.endsWith('_pct') ? '%' : ''}`;
    frag.appendChild(el('span', { class: 'stat-value-live' }, valText));
  });
  return frag;
}

/* ============================================================
   App shell: top-level tabs. Collection tab uses an internal
   sidenav + anchor scroll for Relics/Collectibles/Mounts/Artifacts.
   Equipment/Inheritance/Calculator are their own separate tabs.
   ============================================================ */
const root = document.getElementById('app-root');
let activeMainTab = 'collection';

const mainTabsNav = document.getElementById('main-tabs');
const hamburgerBtn = document.getElementById('hamburger-toggle');
hamburgerBtn.addEventListener('click', () => {
  mainTabsNav.classList.toggle('open');
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeMainTab = btn.dataset.tab;
    mainTabsNav.classList.remove('open');
    render();
  });
});

document.addEventListener('click', (e) => {
  if (mainTabsNav.classList.contains('open') && !mainTabsNav.contains(e.target) && e.target !== hamburgerBtn) {
    mainTabsNav.classList.remove('open');
  }
});

function tierSlug(tier) {
  return (tier || 'untiered').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildTierGroups(items, field = 'tier') {
  const grouped = {};
  items.forEach(item => {
    const tier = item[field] || '(Untiered)';
    (grouped[tier] = grouped[tier] || []).push(item);
  });
  const ordered = [...TIER_ORDER.filter(t => grouped[t]), ...Object.keys(grouped).filter(t => !TIER_ORDER.includes(t))];
  return ordered.map(tier => ({ tier, slug: tierSlug(tier), items: grouped[tier] }));
}

const COLLECTION_SECTIONS = [
  { id: 'relics', label: 'Relics', build: renderRelics, sub: () => buildTierGroups(DB.relics, 'rarity'), clearAll: () => clearAllRelics() },
  { id: 'collectibles', label: 'Collectibles', build: renderCollectibles, sub: () => buildTierGroups(DB.collectibles, 'rarity'), clearAll: () => clearAllCollectibles() },
  { id: 'mounts', label: 'Mounts', build: () => renderMountsOrArtifacts('mounts'), sub: () => buildTierGroups(DB.mounts.filter(x => x.n !== 'None')), clearAll: () => clearAllMountsOrArtifacts('mounts') },
  { id: 'artifacts', label: 'Artifacts', build: () => renderMountsOrArtifacts('artifacts'), sub: () => buildTierGroups(DB.artifacts.filter(x => x.n !== 'None')), clearAll: () => clearAllMountsOrArtifacts('artifacts') },
  { id: 'fashion', label: 'Fashion Level', build: buildFashionSectionContent, clearAll: () => { state.fashionLevel = 0; saveState(); render(); } },
  { id: 'homestead', label: 'Homestead', build: buildHomesteadSectionContent, clearAll: () => { state.homestead = {}; saveState(); render(); } },
  // Pets deliberately hidden from Collection for now (still fully built —
  // Equipment tab's Pet card already covers pet selection/arcana/skills).
  // Remind J this section still exists next time Collection scope comes up.
  // { id: 'pets', label: 'Pets', build: renderPets, sub: () => buildTierGroups(DB.pets) },
];

function parseFashionNoteStats(note) {
  const result = {};
  if (!note) return result;
  note.split(',').forEach(part => {
    const m = part.trim().match(/^\+(\d+(?:\.\d+)?)%\s+(HP|ATK|DEF)$/);
    if (m) result[m[2]] = parseFloat(m[1]);
  });
  return result;
}

function buildFashionSectionContent() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Cumulative bonuses from Fashion Level 1 up to your selected level — every stat stacks from every level along the way, not just the one you land on.'));

  const levels = DB.fashion_levels || [];
  const levelInput = el('input', {
    type: 'number', class: 'equip-select', style: 'max-width:220px;', min: '0', max: '50', placeholder: '0',
    value: state.fashionLevel ? String(state.fashionLevel) : '',
  });
  levelInput.addEventListener('input', (e) => {
    const n = parseInt(e.target.value, 10);
    state.fashionLevel = Number.isNaN(n) ? 0 : Math.max(0, Math.min(50, n));
    saveState();
  });
  levelInput.addEventListener('blur', () => render());
  wrap.appendChild(equipFieldLabel('Fashion Level'));
  wrap.appendChild(levelInput);

  if (state.fashionLevel > 0) {
    let totalFd = 0, totalFdr = 0;
    const statTotals = {};
    for (let i = 1; i <= state.fashionLevel; i++) {
      const lv = levels[i];
      if (!lv) continue;
      totalFd += lv.fd || 0;
      totalFdr += lv.fdr || 0;
      Object.entries(parseFashionNoteStats(lv.note)).forEach(([stat, val]) => {
        statTotals[stat] = (statTotals[stat] || 0) + val;
      });
    }
    const parts = [
      `Final DMG +${Math.round(totalFd * 10000) / 100}%`,
      `Final DMG Reduction +${Math.round(totalFdr * 10000) / 100}%`,
      ...Object.entries(statTotals).map(([stat, val]) => `${stat} +${Math.round(val * 100) / 100}%`),
    ];
    wrap.appendChild(equipFieldLabel('Totals at this level'));
    wrap.appendChild(el('div', { class: 'equip-writeup' }, parts.join(' · ')));
  }

  return wrap;
}

function buildHomesteadSectionContent() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Buildings you own grant passive stats at whichever level you\u2019ve upgraded them to. Set each to Level 0 if you don\u2019t own it.'));

  const buildings = DB.homestead_buildings || [];
  const card = el('div', { class: 'equip-card' });
  buildings.forEach(b => {
    const currentLevel = state.homestead[b.id] || 0;
    card.appendChild(equipFieldLabel(`${b.name}${b.event ? ` (${b.event})` : ''} — ${b.label}`));
    const select = el('select', { class: 'equip-select' }, [
      el('option', { value: '0', selected: currentLevel === 0 ? 'true' : null }, 'Level 0 (not owned)'),
      ...b.values.map((v, i) => {
        const lv = i + 1;
        return el('option', { value: String(lv), selected: lv === currentLevel ? 'true' : null }, `Level ${lv}`);
      }),
    ]);
    select.addEventListener('change', (e) => {
      const lv = parseInt(e.target.value, 10);
      if (lv === 0) delete state.homestead[b.id];
      else state.homestead[b.id] = lv;
      saveState();
      render();
    });
    card.appendChild(select);
    if (currentLevel > 0) {
      const val = b.values[currentLevel - 1];
      const pct = Math.round(val * 10000) / 100;
      card.appendChild(el('div', { class: 'equip-writeup' }, `${b.label} +${pct}%`));
    }
  });
  wrap.appendChild(el('div', { class: 'equip-grid equip-grid-single' }, [card]));
  return wrap;
}

function renderPlaceholder(label) {
  return el('div', {}, [
    el('div', { class: 'section-title' }, label),
    el('p', { class: 'section-desc' }, `${label} is being built next.`),
  ]);
}

/* ============================================================
   Inheritance Tree
   ============================================================ */
const INHERIT_TREE_NAMES = { sk: 'Skeleton', kn: 'Knight', rn: 'Ranger', gh: 'Ghost', dr: 'Dragon' };
// Active-tree dropdown deliberately excludes Dragon — matches what was
// asked for explicitly. Dragon is still fully viewable/editable via its
// own tab, just not selectable as the "deployed" tree.
const INHERIT_ACTIVE_TREE_OPTIONS = ['sk', 'kn', 'rn', 'gh'];

function getInheritNodeValue(treeKey, nodeId) {
  return state.inheritance.progress[treeKey][nodeId] || 0;
}

function setInheritNodeValue(treeKey, nodeId, val) {
  state.inheritance.progress[treeKey][nodeId] = val;
}

function renderInheritNodeInput(treeKey, nodeId, max) {
  if (max === 0) return el('span', { class: 'inherit-node-na' }, '\u2014');
  const val = getInheritNodeValue(treeKey, nodeId);
  const input = el('input', {
    type: 'number', class: 'inherit-node-input', min: '0', max: String(max), value: String(val),
    oninput: (e) => {
      const n = parseInt(e.target.value, 10);
      const clamped = Number.isNaN(n) ? 0 : Math.max(0, Math.min(max, n));
      setInheritNodeValue(treeKey, nodeId, clamped);
      saveState();
    },
    onblur: () => render(),
  });
  return el('div', { class: 'inherit-node-input-wrap' }, [input, el('span', { class: 'inherit-node-max' }, `/${max}`)]);
}

function renderInheritNodeRow(treeKey, nodeId, name, max) {
  return el('div', { class: 'inherit-node-row' }, [
    el('span', { class: 'inherit-node-name' }, name || '(unnamed)'),
    renderInheritNodeInput(treeKey, nodeId, max),
  ]);
}

function renderInheritTriplet(treeKey, seg, td, tm) {
  const idx = seg - 1;
  const row = el('div', { class: 'inherit-triplet-row' });

  const leftCol = el('div', { class: 'inherit-col' });
  ['a', 'b', 'c'].forEach((sub, i) => {
    const key = `l${seg}${sub}`;
    if (tm[key] !== undefined) leftCol.appendChild(renderInheritNodeBox(treeKey, key, td.left[idx][i], tm[key]));
  });

  const midCol = el('div', { class: 'inherit-col inherit-col-mid' });
  const midKey = `m${seg}`;
  if (tm[midKey] !== undefined) midCol.appendChild(renderInheritNodeBox(treeKey, midKey, td.mid[idx], tm[midKey]));

  const rightCol = el('div', { class: 'inherit-col' });
  ['a', 'b', 'c'].forEach((sub, i) => {
    const key = `r${seg}${sub}`;
    if (tm[key] !== undefined) rightCol.appendChild(renderInheritNodeBox(treeKey, key, td.right[idx][i], tm[key]));
  });

  row.appendChild(leftCol);
  row.appendChild(midCol);
  row.appendChild(rightCol);
  return row;
}

function renderInheritNodeBox(treeKey, nodeId, name, max) {
  return el('div', { class: 'inherit-node-box' }, [
    el('span', { class: 'inherit-node-name' }, name || '(unnamed)'),
    renderInheritNodeInput(treeKey, nodeId, max),
  ]);
}

function renderInheritanceShell() {
  const wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'section-title' }, 'Inheritance Tree'));
  wrap.appendChild(el('p', { class: 'section-desc' },
    'The Active Tree is the deployed tree in battle, not the current skill level for the tree.'));

  // Active tree dropdown — sits above the tabs, deliberately a separate
  // concept from "which tab am I viewing right now."
  const activeRow = el('div', { class: 'inherit-active-row' });
  activeRow.appendChild(el('span', { class: 'equip-field-label' }, 'Active Tree'));
  const activeSelect = el('select', { class: 'equip-select', style: 'max-width:220px;' },
    INHERIT_ACTIVE_TREE_OPTIONS.map(k => el('option', { value: k, selected: k === state.inheritance.activeTree ? 'true' : null }, INHERIT_TREE_NAMES[k])));
  activeSelect.addEventListener('change', (e) => {
    state.inheritance.activeTree = e.target.value;
    saveState();
    render();
  });
  activeRow.appendChild(activeSelect);
  wrap.appendChild(activeRow);

  // Tree tabs
  const tabRow = el('div', { class: 'inherit-tab-row' });
  Object.keys(INHERIT_TREE_NAMES).forEach(k => {
    const isActive = k === state.inheritance.viewingTree;
    const isDeployed = k === state.inheritance.activeTree;
    tabRow.appendChild(el('button', {
      class: 'inherit-tab-btn' + (isActive ? ' active' : ''),
      onclick: () => { state.inheritance.viewingTree = k; render(); },
    }, [INHERIT_TREE_NAMES[k], isDeployed ? el('span', { class: 'inherit-deployed-dot' }) : null]));
  });
  wrap.appendChild(tabRow);

  const treeKey = state.inheritance.viewingTree;
  const td = DB.inherit_def[treeKey];
  const tm = DB.inherit_max[treeKey];

  const toolRow = el('div', { class: 'inherit-tool-row' });
  toolRow.appendChild(el('button', {
    class: 'bulk-action-btn primary',
    onclick: () => {
      Object.entries(tm).forEach(([nodeId, max]) => setInheritNodeValue(treeKey, nodeId, max));
      saveState();
      render();
    },
  }, 'Fill to Max'));
  toolRow.appendChild(el('button', {
    class: 'bulk-action-btn secondary',
    onclick: () => {
      state.inheritance.progress[treeKey] = {};
      saveState();
      render();
    },
  }, 'Clear Tree'));
  wrap.appendChild(toolRow);

  const grid = el('div', { class: 'inherit-chain' });

  // Hero node — only meaningfully investable at segment 1 (h2-h6 are empty
  // visual placeholders in the source data, no cost/function), sits at the
  // very top of the chain like the reference layout shows.
  const heroName = td.hero[0] || '';
  grid.appendChild(el('div', { class: 'inherit-chain-node inherit-chain-hero' }, [
    el('span', { class: 'inherit-node-name' }, heroName || 'Hero'),
    renderInheritNodeInput(treeKey, 'h1', tm.h1),
  ]));

  // The tree is really one continuous chain, not 6 independent groups:
  // each Left/Mid/Right triplet is followed by a standalone named
  // skill-rank node (Skeleton Recruit → ... → Bone King) before the next
  // triplet begins — confirmed against the reference layout and the
  // source data (skill[i-1] pairs with node s{i}, for i=1..5; s6 has no
  // name and max 0, so the chain just ends after the 6th triplet).
  for (let seg = 1; seg <= td.segments; seg++) {
    grid.appendChild(renderInheritTriplet(treeKey, seg, td, tm));

    const skillKey = `s${seg}`;
    const skillName = td.skill[seg - 1];
    if (tm[skillKey] !== undefined && tm[skillKey] > 0 && skillName) {
      grid.appendChild(el('div', { class: 'inherit-chain-node inherit-chain-skillname' }, [
        el('span', { class: 'inherit-node-name' }, skillName),
        renderInheritNodeInput(treeKey, skillKey, tm[skillKey]),
      ]));
    }
  }
  wrap.appendChild(grid);

  return wrap;
}

/* ============================================================
   Equipment
   ============================================================ */
const EQUIPMENT_SLOTS = [
  { id: 'weapon', label: 'Weapon', dataKey: 'weapons', psiKey: 'weapon', gemKey: 'weapon', imgKind: 'weapons' },
  { id: 'armor', label: 'Armor', dataKey: 'armors', psiKey: 'armor', gemKey: 'armor', imgKind: 'armors' },
  { id: 'ring1', label: 'Ring 1', dataKey: 'rings', psiKey: 'ring', gemKey: 'ring', imgKind: 'rings' },
  { id: 'ring2', label: 'Ring 2', dataKey: 'rings', psiKey: 'ring', gemKey: 'ring', imgKind: 'rings' },
  { id: 'accessory1', label: 'Accessory 1', dataKey: 'accessories', psiKey: 'accessory', gemKey: 'accessory', imgKind: 'accessories' },
  { id: 'accessory2', label: 'Accessory 2', dataKey: 'accessories', psiKey: 'accessory', gemKey: 'accessory', imgKind: 'accessories' },
];

const GEM_TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Immortal', 'Transcendent', 'Peerless'];

function getEquipState(slotId) {
  if (!state.equipment[slotId]) {
    state.equipment[slotId] = {
      itemName: '', quality: '', surpass: 0, arcana: -1, // -1 = "No Arcana"
      psionics: [0, 1, 2, 3].map(() => ({ stat: '', val: 0 })),
      gems: [0, 1, 2, 3, 4].map(() => ({ gemId: '', tier: 9 })), // tier 9 = Peerless
    };
  }
  return state.equipment[slotId];
}

function buildEquipmentSectionContent() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Quality defaults to Mythic and gems default to peerless'));
  const grid = el('div', { class: 'equip-grid' });
  EQUIPMENT_SLOTS.forEach(slotDef => grid.appendChild(renderEquipCard(slotDef)));
  wrap.appendChild(grid);
  return wrap;
}

function buildPetSectionContent() {
  const wrap = el('div', {});
  const petGrid = el('div', { class: 'equip-grid' });
  [0, 1, 2].forEach(i => petGrid.appendChild(renderEquipPetCard(i)));
  wrap.appendChild(petGrid);
  return wrap;
}

function buildMountsSectionContent() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Mounts that are marked as owned in collections are allowed to be equipped here.'));
  const mainGrid = el('div', { class: 'equip-grid equip-grid-single' });
  mainGrid.appendChild(renderDeployCard('mount', 'star', null));
  wrap.appendChild(mainGrid);
  const grid = el('div', { class: 'equip-grid' });
  [0, 1, 2].forEach(i => grid.appendChild(renderDeployCard('mount', 'awaken', i)));
  wrap.appendChild(grid);
  return wrap;
}

function buildArtifactsSectionContent() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Artifacts that are marked as owned in collections are allowed to be equipped here.'));
  const mainGrid = el('div', { class: 'equip-grid equip-grid-single' });
  mainGrid.appendChild(renderDeployCard('artifact', 'star', null));
  wrap.appendChild(mainGrid);
  const grid = el('div', { class: 'equip-grid' });
  [0, 1, 2].forEach(i => grid.appendChild(renderDeployCard('artifact', 'awaken', i)));
  wrap.appendChild(grid);
  return wrap;
}

/* ---------- Adventurer, Heroes & Brands ---------- */

// Adventurer tier_effects mix skill descriptions with plain stat-buff lines
// ("Adventurer's ATK +25%"). The "main skill" shown at any star level is the
// latest non-buff entry at or below that level; buffs are summed separately
// across every buff entry up to that level (confirmed additive, same as
// every other tiered-bonus system in this app).
function parseAdventurerStatBuff(text) {
  const m = text && text.match(/^Adventurer'?s (\w+) \+(\d+(?:\.\d+)?)%$/);
  return m ? { stat: m[1], val: parseFloat(m[2]) } : null;
}
function computeAdventurerDisplay(tierEffects, stars) {
  let mainSkillIdx = -1, mainSkillText = null;
  const statTotals = {};
  for (let i = 0; i <= stars && i < (tierEffects || []).length; i++) {
    const text = tierEffects[i];
    if (!text) continue;
    const buff = parseAdventurerStatBuff(text);
    if (buff) statTotals[buff.stat] = (statTotals[buff.stat] || 0) + buff.val;
    else { mainSkillIdx = i; mainSkillText = text; }
  }
  return { mainSkillIdx, mainSkillText, statTotals };
}

function renderAdventurerCard() {
  const s = state.adventurerSlot;
  const advs = (DB.adventurers || []).filter(a => a.n !== 'None');
  const adv = advs.find(a => a.n === s.name);

  const card = el('div', { class: 'equip-card' });
  const headerImg = adv
    ? el('img', { src: itemImagePath('adventurers', adv), alt: adv.n, class: 'equip-card-thumb', onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-card-thumb placeholder' });
  card.appendChild(el('div', { class: 'equip-card-header' }, [headerImg, el('div', { class: 'equip-card-title' }, 'Adventurer')]));

  card.appendChild(equipFieldLabel('Adventurer'));
  card.appendChild(renderSearchCombo({
    value: s.name,
    options: advs.map(a => a.n),
    placeholder: 'Search adventurers…',
    onSelect: (name) => { s.name = name; s.stars = 0; saveState(); render(); },
    onClear: () => { s.name = ''; s.stars = 0; saveState(); render(); },
  }));

  if (!adv) return card;

  card.appendChild(equipFieldLabel('Stars'));
  card.appendChild(el('input', {
    type: 'number', class: 'equip-select', min: '0', max: '10', value: String(s.stars || 0),
    oninput: (e) => {
      const n = parseInt(e.target.value, 10);
      s.stars = Number.isNaN(n) ? 0 : Math.max(0, Math.min(10, n));
      saveState();
      render();
    },
  }));

  const { mainSkillIdx, mainSkillText, statTotals } = computeAdventurerDisplay(adv.tier_effects, s.stars);
  if (mainSkillText) {
    card.appendChild(equipFieldLabel(`Main Skill (level ${mainSkillIdx} skill)`));
    card.appendChild(el('div', { class: 'equip-writeup' }, renderTextWithSkillTags(mainSkillText)));
  }
  const buffParts = Object.entries(statTotals).map(([k, v]) => `${k} +${Math.round(v * 100) / 100}%`);
  if (buffParts.length) {
    card.appendChild(equipFieldLabel('Adventurer Stat Buffs'));
    card.appendChild(el('div', { class: 'equip-writeup' }, buffParts.join(', ')));
  }

  return card;
}

// NOTE ON CATEGORIZATION: the source data has no S/Basic split for heroes,
// or SS/S/Basic split for brands — only the 4 named Inheritance Heroes are
// confirmed. Everything else defaults into one placeholder bucket below
// until that classification is provided; flagged clearly so it's not
// mistaken for confirmed data.
const INHERITANCE_HERO_NAMES = new Set(['Legendary Ranger', 'Legendary Knight', 'Ghost Princess', 'Bone King']);
function classifyHero(name) {
  return INHERITANCE_HERO_NAMES.has(name) ? 'Inheritance Heroes' : 'Basic Heroes';
}
function classifyBrand(name) {
  return 'Basic Brands';
}

function hasRealPolarization(entity) {
  return Object.values(entity.polarization_effects || {}).some(v => v != null);
}

function renderHeroOrBrandCard(kind, slotIndex) {
  const isHero = kind === 'hero';
  const s = isHero ? state.heroSlots[slotIndex] : state.brandSlots[slotIndex];
  const all = isHero ? (DB.heroes || []).filter(h => h.n !== 'None') : (DB.brands || []);
  const classify = isHero ? classifyHero : classifyBrand;
  const groupOrder = isHero ? ['S Heroes', 'Basic Heroes', 'Inheritance Heroes'] : ['SS Brands', 'S Brands', 'Basic Brands'];

  // Hide non-allowed Inheritance Heroes entirely — future-proofed even
  // though every Inheritance-classified hero we have today is allowed.
  const options = isHero
    ? all.filter(h => classify(h.n) !== 'Inheritance Heroes' || INHERITANCE_HERO_NAMES.has(h.n))
    : all;

  const entity = options.find(x => x.n === s.name);
  const label = isHero ? `Hero ${slotIndex + 1}` : `Brand ${slotIndex + 1}`;
  const imgKind = isHero ? 'heroes' : 'brands';

  const card = el('div', { class: 'equip-card' });
  const headerImg = entity
    ? el('img', { src: itemImagePath(imgKind, entity), alt: entity.n, class: 'equip-card-thumb', onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-card-thumb placeholder' });
  card.appendChild(el('div', { class: 'equip-card-header' }, [headerImg, el('div', { class: 'equip-card-title' }, label)]));

  card.appendChild(equipFieldLabel(label));
  const byGroup = {};
  options.forEach(o => { (byGroup[classify(o.n)] = byGroup[classify(o.n)] || []).push(o); });
  const sortedOptions = groupOrder.filter(g => byGroup[g]).flatMap(g => byGroup[g]);
  const optionLabel = (o) => `${o.n} \u2014 ${classify(o.n)}`;

  card.appendChild(renderSearchCombo({
    value: entity ? optionLabel(entity) : '',
    options: sortedOptions.map(optionLabel),
    placeholder: `Search ${isHero ? 'heroes' : 'brands'}…`,
    onSelect: (chosenLabel) => {
      const newEntity = sortedOptions.find(o => optionLabel(o) === chosenLabel);
      if (!newEntity) return;
      s.name = newEntity.n;
      // Inheritance Heroes default to Rare, not the usual highest-available —
      // they're the low-investment tier tied to the inheritance tree, so
      // assuming Mythic like everything else doesn't fit.
      if (classify(newEntity.n) === 'Inheritance Heroes' && (newEntity.q || []).includes('Rare')) {
        s.quality = 'Rare';
      } else {
        s.quality = newEntity.q && newEntity.q.length ? newEntity.q[newEntity.q.length - 1] : '';
      }
      s.polarization = 0;
      saveState();
      render();
    },
    onClear: () => {
      s.name = '';
      s.quality = '';
      s.polarization = 0;
      saveState();
      render();
    },
  }));

  if (!entity) return card;

  card.appendChild(equipFieldLabel('Quality'));
  const qualOpts = entity.q || [];
  const qualitySelect = el('select', { class: 'equip-select', disabled: qualOpts.length ? null : 'true' },
    qualOpts.length
      ? qualOpts.map(q => el('option', { value: q, selected: q === s.quality ? 'true' : null }, q))
      : [el('option', { value: '' }, '—')]);
  qualitySelect.addEventListener('change', (e) => { s.quality = e.target.value; saveState(); render(); });
  card.appendChild(qualitySelect);

  const showPolarization = hasRealPolarization(entity);
  if (showPolarization) {
    const isMythic = s.quality === 'Mythic';
    card.appendChild(equipFieldLabel('Polarization'));
    const polOpts = Array.from({ length: 10 }, (_, i) => i + 1);
    const polSelect = el('select', { class: 'equip-select', disabled: isMythic ? null : 'true' }, [
      el('option', { value: '0', selected: !isMythic || s.polarization === 0 ? 'true' : null }, 'Not Polarised'),
      ...polOpts.map(p => el('option', { value: String(p), selected: p === s.polarization ? 'true' : null }, `P${p}`)),
    ]);
    polSelect.addEventListener('change', (e) => { s.polarization = parseInt(e.target.value, 10); saveState(); render(); });
    card.appendChild(polSelect);
  }

  if (entity.quality_effects && s.quality) {
    const text = entity.quality_effects[s.quality];
    if (text) {
      card.appendChild(equipFieldLabel(`${s.quality} Skill`));
      card.appendChild(el('div', { class: 'equip-writeup' }, renderTextWithSkillTags(text)));
    }
  }
  if (showPolarization && s.quality === 'Mythic' && s.polarization > 0) {
    const text = entity.polarization_effects[`P${s.polarization}`];
    if (text) {
      card.appendChild(equipFieldLabel(`P${s.polarization} Bonus`));
      card.appendChild(el('div', { class: 'equip-writeup' }, renderTextWithSkillTags(text)));
    }
  }

  return card;
}

function buildAdventurerHeroBrandSectionContent() {
  const wrap = el('div', {});

  wrap.appendChild(el('div', { class: 'equip-section-title' }, 'Adventurer'));
  const advGrid = el('div', { class: 'equip-grid equip-grid-single' });
  advGrid.appendChild(renderAdventurerCard());
  wrap.appendChild(advGrid);

  wrap.appendChild(el('div', { class: 'equip-section-title' }, 'Heroes'));
  const heroGrid = el('div', { class: 'equip-grid' });
  [0, 1].forEach(i => heroGrid.appendChild(renderHeroOrBrandCard('hero', i)));
  wrap.appendChild(heroGrid);

  wrap.appendChild(el('div', { class: 'equip-section-title' }, 'Brands'));
  const brandGrid = el('div', { class: 'equip-grid' });
  [0, 1, 2, 3].forEach(i => brandGrid.appendChild(renderHeroOrBrandCard('brand', i)));
  wrap.appendChild(brandGrid);

  return wrap;
}


const EQUIPMENT_SECTIONS = [
  { id: 'equip-equipment', label: 'Equipment', build: buildEquipmentSectionContent, clearAll: () => clearAllEquipment() },
  { id: 'equip-pet', label: 'Pet', build: buildPetSectionContent },
  { id: 'equip-relics', label: 'Relics', build: buildRelicsSectionContent, clearAll: () => { state.relicSlots = { totem1: null, totem2: null, core: null, guardian: null }; saveState(); render(); } },
  { id: 'equip-mounts', label: 'Mounts', build: buildMountsSectionContent },
  { id: 'equip-artifacts', label: 'Artifacts', build: buildArtifactsSectionContent },
  { id: 'equip-adv-hero-brand', label: 'Adventurer, Heroes & Brands', build: buildAdventurerHeroBrandSectionContent },
];

const RELIC_DEPLOY_SLOTS = [
  { key: 'totem1', label: 'Totem 1', type: 'totem' },
  { key: 'totem2', label: 'Totem 2', type: 'totem' },
  { key: 'core', label: 'Core', type: 'core' },
  { key: 'guardian', label: 'Guardian', type: 'guardian' },
];

function buildRelicsSectionContent() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Relics that are marked as owned in collections are allowed to be equipped here'));
  const grid = el('div', { class: 'equip-grid' });
  RELIC_DEPLOY_SLOTS.forEach(slot => grid.appendChild(renderRelicDeployCard(slot)));
  wrap.appendChild(grid);
  return wrap;
}

function renderRelicDeployCard(slotDef) {
  const relics = (DB.relics || []).filter(r => r.deploy_type === slotDef.type);
  const ownedOptions = sortByTierDesc(relics.filter(r => state.relicOwned[r.n]), 'rarity');
  const currentName = state.relicSlots[slotDef.key];
  const relic = ownedOptions.find(r => r.n === currentName) || null;

  const card = el('div', { class: 'equip-card' });
  const headerImg = relic
    ? el('img', { src: itemImagePath('relics', relic), alt: relic.n, class: 'equip-card-thumb', onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-card-thumb placeholder' });
  card.appendChild(el('div', { class: 'equip-card-header' }, [headerImg, el('div', { class: 'equip-card-title' }, slotDef.label)]));

  const linkText = 'Information prefilled from your Collections. To update it, please change it ';
  const link = el('a', {
    href: '#', class: 'equip-collection-link',
    onclick: (e) => { e.preventDefault(); goToCollectionSection('relics'); },
  }, 'here');
  card.appendChild(el('p', { class: 'equip-prefill-note' }, [linkText, link, '.']));

  card.appendChild(equipFieldLabel(slotDef.label));
  if (!ownedOptions.length) {
    card.appendChild(el('div', { class: 'equip-writeup' },
      `You haven't marked any owned ${slotDef.type}-type relics in Collection yet.`));
    return card;
  }

  const select = el('select', { class: 'equip-select' }, [
    el('option', { value: '' }, '— None —'),
    ...ownedOptions.map(r => el('option', { value: r.n, selected: r.n === currentName ? 'true' : null }, r.n)),
  ]);
  select.addEventListener('change', (e) => {
    state.relicSlots[slotDef.key] = e.target.value || null;
    saveState();
    render();
  });
  card.appendChild(select);

  if (!relic) return card;

  const star = state.relicStars[relic.n] || 0;
  card.appendChild(equipFieldLabel('Stars'));
  card.appendChild(el('div', { class: 'equip-writeup' }, `${star}★`));

  // Same tiered-effect logic as the Collection relic card — the same
  // 0★/5★/10★ breakpoints, since deployed relics don't get finer granularity.
  let effectText = relic.effect;
  let effectLabel = '10★';
  if (relic.effect_base) {
    if (star < 5) { effectText = relic.effect_base; effectLabel = '0★'; }
    else if (star < 10) { effectText = relic.effect_5star; effectLabel = '5★'; }
    else { effectText = relic.effect; effectLabel = '10★'; }
  }
  if (effectText) {
    card.appendChild(equipFieldLabel(`${effectLabel} Skill`));
    card.appendChild(el('div', { class: 'equip-writeup' }, renderTextWithSkillTags(effectText)));
  }

  if (relic.star_stats) {
    const nodes = formatStatBlockNodes(
      Object.fromEntries(Object.entries(relic.star_stats).map(([stat, vals]) => [stat, vals[star]]))
    );
    card.appendChild(equipFieldLabel('Stats'));
    card.appendChild(el('div', { class: 'equip-writeup' }, nodes));
  }

  return card;
}

function renderEquipmentShell() {
  return renderSectionShell(EQUIPMENT_SECTIONS);
}

function clearAllEquipment() {
  state.equipment = {};
  state.petSlots = state.petSlots.map(() => ({
    itemName: '', arcana: -1, level: 0, armament: '', armamentLevel: 1,
    skills: [{ stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }, { stat: '', val: 0 }],
  }));
  state.mountSlots = [{ itemIdx: null }, { itemIdx: null }, { itemIdx: null }];
  state.mountMainSlot = { itemIdx: null };
  state.artifactSlots = [{ itemIdx: null }, { itemIdx: null }, { itemIdx: null }];
  state.artifactMainSlot = { itemIdx: null };
  state.relicSlots = { totem1: null, totem2: null, core: null, guardian: null };
  saveState();
  render();
}

// Reusable "Clear All" trigger + confirmation modal, used at the top of
// every Collection section and the whole Equipment tab. Destructive confirm
// button is visually distinct from the neutral cancel button — the trigger
// itself stays low-key until someone actually commits to the modal.
function renderClearAllButton(label, onConfirm) {
  return el('button', {
    class: 'clear-all-btn',
    onclick: () => openClearAllModal(label, onConfirm),
  }, 'Clear All');
}

function openClearAllModal(label, onConfirm) {
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } });
  const box = el('div', { class: 'modal-box' }, [
    el('div', { class: 'modal-title' }, `Clear ${label}?`),
    el('p', { class: 'modal-confirm-text' },
      `All the data you've entered in "${label}" will be cleared. Are you sure you want to continue?`),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'bulk-action-btn secondary', onclick: closeModal }, 'Cancel'),
      el('button', {
        class: 'bulk-action-btn destructive',
        onclick: () => { onConfirm(); closeModal(); },
      }, 'Continue'),
    ]),
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  function closeModal() { overlay.remove(); }
}

// Jumps to a Collection section from a different tab — switches tabs first,
// then scrolls once the new content has actually rendered.
function goToCollectionSection(sectionId) {
  activeMainTab = 'collection';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'collection'));
  render();
  setTimeout(() => {
    const target = document.getElementById(sectionId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

/* ---------- Pet card ---------- */
// A proper custom combobox — text input + a clickable filtered dropdown —
// replacing the native <input list> + <datalist> pattern, which has real
// cross-browser reliability problems (Safari's support is especially
// unreliable) and had no way to actually clear a selection once made: the
// box could look empty while the old value stayed active underneath.
// Filtering while typing updates only the dropdown's own DOM locally, not
// a full app re-render, so the input never loses focus mid-type.
function renderSearchCombo({ value, options, placeholder, onSelect, onClear }) {
  const container = el('div', { class: 'search-combo' });
  const input = el('input', {
    type: 'text', class: 'equip-combo-input', placeholder, value: value || '',
    autocomplete: 'off',
  });
  const clearBtn = el('button', {
    type: 'button', class: 'search-combo-clear' + (value ? '' : ' hidden'),
    onclick: (e) => { e.stopPropagation(); input.value = ''; closeDropdown(); if (onClear) onClear(); },
  }, '×');
  const dropdown = el('div', { class: 'search-combo-dropdown hidden' });

  function closeDropdown() { dropdown.classList.add('hidden'); dropdown.innerHTML = ''; }

  function openDropdown(filterText) {
    const q = (filterText || '').toLowerCase();
    const matches = options.filter(o => o.toLowerCase().includes(q)).slice(0, 60);
    dropdown.innerHTML = '';
    if (!matches.length) {
      dropdown.appendChild(el('div', { class: 'search-combo-empty' }, 'No matches'));
    } else {
      matches.forEach(opt => {
        dropdown.appendChild(el('div', {
          class: 'search-combo-option',
          onmousedown: (e) => {
            // mousedown (not click) fires before the input's blur, so the
            // selection registers before the dropdown gets torn down
            e.preventDefault();
            input.value = opt;
            closeDropdown();
            onSelect(opt);
          },
        }, opt));
      });
    }
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('focus', () => openDropdown(input.value));
  input.addEventListener('input', () => {
    clearBtn.classList.toggle('hidden', !input.value);
    openDropdown(input.value);
  });
  input.addEventListener('blur', () => closeDropdown());

  container.appendChild(input);
  container.appendChild(clearBtn);
  container.appendChild(dropdown);
  return container;
}

const PET_SKILL_HELPER_TEXT = {
  'Fierce (Combo Rate)': "Gives this pet's hero a chance to trigger a Combo attack — 5% at SS, 10% at SSS.",
  'Sturdy (Counter Rate)': "Gives this pet's hero a chance to Counterattack — 5% at SS, 10% at SSS.",
  'Brutal (Crit Rate)': "Gives this pet's hero a chance to land a Critical Hit — 5% at SS, 10% at SSS.",
  'Agile (Ignore Combo Rate)': "Gives this pet's hero a chance to stop the enemy from Comboing them — 5% at SS, 10% at SSS.",
  'Majestic (Ignore Counter Rate)': "Gives this pet's hero a chance to stop the enemy from Countering them — 5% at SS, 10% at SSS.",
  'Resilience (Ignore Crit Rate)': "Gives this pet's hero a chance to stop the enemy from landing a Critical Hit on them — 5% at SS, 10% at SSS.",
  'Mutation (Pet Base Stats)': "Boosts this pet's own base stats.",
  'Giant (Pet DMG)': "Boosts this pet's own damage output.",
  'Epic Leader (Epic Pet DMG)': 'Boosts the damage of every Epic-rarity pet you have deployed.',
  'Legendary Leader': 'Boosts the damage of every Legendary-rarity pet you have deployed.',
  'Mythic Leader': 'Boosts the damage of every Mythic-rarity pet you have deployed.',
  'Unmovable (Control Immunity Rate)': "Gives this pet's hero a chance to be immune to control effects (like stun or freeze).",
};

function renderEquipPetCard(petIndex) {
  const s = state.petSlots[petIndex];
  const pets = sortByTierDesc(DB.pets || []);
  const pet = pets.find(p => p.n === s.itemName) || null;

  const card = el('div', { class: 'equip-card' });
  const headerImg = pet
    ? el('img', { src: itemImagePath('pets', pet), alt: pet.n, class: 'equip-card-thumb', onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-card-thumb placeholder' });
  card.appendChild(el('div', { class: 'equip-card-header' }, [headerImg, el('div', { class: 'equip-card-title' }, `Pet ${petIndex + 1}`)]));

  card.appendChild(equipFieldLabel('Pet'));
  card.appendChild(renderSearchCombo({
    value: s.itemName,
    options: pets.map(p => p.n),
    placeholder: 'Search pets…',
    onSelect: (name) => {
      s.itemName = name;
      s.arcana = -1;
      saveState();
      render();
    },
    onClear: () => {
      s.itemName = '';
      s.arcana = -1;
      saveState();
      render();
    },
  }));

  if (!pet) return card;

  const hasAwaken = pet.awaken_effects && Object.keys(pet.awaken_effects).length > 0;
  if (hasAwaken) {
    card.appendChild(equipFieldLabel('Arcana'));
    const levels = [];
    for (let i = 0; i <= 10; i++) if (pet.awaken_effects[`A${i}`]) levels.push(i);
    const arcanaSelect = el('select', { class: 'equip-select' }, [
      el('option', { value: '-1', selected: s.arcana === -1 ? 'true' : null }, 'No Arcana'),
      ...levels.map(i => el('option', { value: String(i), selected: i === s.arcana ? 'true' : null }, `A${i}`)),
    ]);
    arcanaSelect.addEventListener('change', (e) => { s.arcana = parseInt(e.target.value, 10); saveState(); render(); });
    card.appendChild(arcanaSelect);

    if (s.arcana >= 0) {
      card.appendChild(el('div', { class: 'equip-writeup' }, `A${s.arcana}: ${pet.awaken_effects[`A${s.arcana}`]}`));
    }
  }

  card.appendChild(el('div', { class: 'equip-section-title' }, 'Battle Skills'));
  card.appendChild(equipFieldLabel('Pet Level'));
  const levelInput = el('input', {
    type: 'number', class: 'equip-select', min: '1', max: '100', value: String(s.level || ''),
    placeholder: 'e.g. 23',
  });
  levelInput.addEventListener('input', (e) => {
    s.level = parseInt(e.target.value, 10) || 0;
    saveState();
  });
  levelInput.addEventListener('blur', () => render());
  card.appendChild(levelInput);

  if (s.level > 0) {
    const battleSkillKeys = Object.keys(pet.battle_skills || {});
    const thresholds = [1, 20, 40, 60, 80];
    let activeIdx = -1;
    for (let i = 0; i < thresholds.length; i++) if (s.level >= thresholds[i]) activeIdx = i;
    const activeKey = activeIdx >= 0 ? battleSkillKeys[activeIdx] : null;
    const activeText = activeKey ? pet.battle_skills[activeKey] : null;
    card.appendChild(equipFieldLabel(activeKey || 'Battle Skill'));
    card.appendChild(el('div', { class: 'equip-writeup' }, activeText ? renderTextWithSkillTags(activeText) : '—'));
  }

  // ---- Pet Armament ----
  card.appendChild(el('div', { class: 'equip-section-title' }, 'Pet Armament'));
  const armaments = DB.pet_armaments || [];
  const armament = armaments.find(a => a.n === s.armament);
  card.appendChild(equipFieldLabel('Armament'));
  card.appendChild(renderSearchCombo({
    value: s.armament,
    options: armaments.map(a => a.n),
    placeholder: 'Search armaments…',
    onSelect: (name) => { s.armament = name; s.armamentLevel = 1; saveState(); render(); },
    onClear: () => { s.armament = ''; saveState(); render(); },
  }));
  if (armament) {
    card.appendChild(equipFieldLabel('Level'));
    const levelSelect = el('select', { class: 'equip-select' },
      Array.from({ length: 10 }, (_, i) => i + 1).map(lv =>
        el('option', { value: String(lv), selected: lv === s.armamentLevel ? 'true' : null }, `Lv.${lv}`)));
    levelSelect.addEventListener('change', (e) => { s.armamentLevel = parseInt(e.target.value, 10); saveState(); render(); });
    card.appendChild(levelSelect);
    const descText = armament.level_descs && armament.level_descs[s.armamentLevel - 1];
    if (descText) card.appendChild(el('div', { class: 'equip-writeup' }, renderTextWithSkillTags(descText)));
  }

  // ---- 5 Skill Slots ----
  card.appendChild(el('div', { class: 'equip-section-title' }, 'Pet Skills'));
  const allAttrs = DB.pet_attrs || [];
  const fixedTierSkills = new Set(DB.pet_fixed_tier_skills || []);

  s.skills.forEach((slot, si) => {
    card.appendChild(equipFieldLabel(`Skill ${si + 1}`));
    const wrap = el('div', { class: 'equip-inline-row' });

    const combo = renderSearchCombo({
      value: slot.stat,
      options: allAttrs.map(a => a.name),
      placeholder: 'Search skill…',
      onSelect: (name) => { slot.stat = name; slot.val = 0; saveState(); render(); },
      onClear: () => { slot.stat = ''; slot.val = 0; saveState(); render(); },
    });
    wrap.appendChild(combo);

    const isFixed = slot.stat && fixedTierSkills.has(slot.stat);
    if (isFixed) {
      const tierSelect = el('select', { class: 'equip-select equip-tier-select' }, [
        el('option', { value: '5', selected: slot.val === 5 ? 'true' : null }, 'SS (5%)'),
        el('option', { value: '10', selected: slot.val === 10 ? 'true' : null }, 'SSS (10%)'),
      ]);
      tierSelect.addEventListener('change', (e) => { slot.val = parseInt(e.target.value, 10); saveState(); render(); });
      wrap.appendChild(tierSelect);
    } else {
      const valInput = el('input', {
        type: 'number', class: 'equip-num-input', min: '0', placeholder: '0',
        value: slot.val ? String(slot.val) : '',
        oninput: (e) => {
          const n = parseFloat(e.target.value);
          if (n < 0) { e.target.classList.add('input-error'); return; }
          e.target.classList.remove('input-error');
          slot.val = Number.isNaN(n) ? 0 : n;
          saveState();
        },
        onblur: (e) => { e.target.classList.remove('input-error'); render(); },
      });
      wrap.appendChild(el('div', { class: 'equip-pct-input-group' }, [valInput, el('span', {}, '%')]));
    }

    const container = el('div', {}, [wrap]);
    if (slot.stat) {
      container.appendChild(el('div', { class: 'equip-writeup' }, `${slot.stat} +${slot.val}%`));
      // Fixed-tier (SS/SSS) skills already spell out both breakpoints
      // right in the stat name/value shown above — the extra plain-English
      // helper paragraph is redundant for those specifically, unlike the
      // free-typed skills where it's the only explanation of what the
      // stat actually does.
      const helper = !isFixed && PET_SKILL_HELPER_TEXT[slot.stat];
      if (helper) container.appendChild(el('div', { class: 'equip-writeup', style: 'color:var(--ink-faint);font-size:11px;' }, helper));
    }
    card.appendChild(container);
  });

  return card;
}

/* ---------- Deployed Mount / Artifact card ---------- */
function renderDeployCard(kind, mode, slotIndex) {
  const isMount = kind === 'mount';
  const isAwakenMode = mode === 'awaken';
  const s = slotIndex === null
    ? state[isMount ? 'mountMainSlot' : 'artifactMainSlot']
    : state[isMount ? 'mountSlots' : 'artifactSlots'][slotIndex];

  const all = (DB[isMount ? 'mounts' : 'artifacts'] || []).filter(it => it.n !== 'None');
  const bucketKey = isMount ? 'mountState' : 'artifactState';
  const ownedItems = sortByTierDesc(all.filter(it => {
    const st = state[bucketKey][it.idx];
    return st && st.owned;
  }));
  const item = ownedItems.find(it => it.idx === s.itemIdx) || null;
  const itemState = item ? getMountOrArtifactState(bucketKey, item.idx) : null;

  const cardTitle = slotIndex === null
    ? `Main ${isMount ? 'Mount' : 'Artifact'}`
    : `Deployed ${isMount ? 'Mount' : 'Artifact'} ${slotIndex + 1}`;

  const card = el('div', { class: 'equip-card' });
  const headerImg = item
    ? el('img', { src: itemImagePath(isMount ? 'mounts' : 'artifacts', item), alt: item.n, class: 'equip-card-thumb', onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-card-thumb placeholder' });
  card.appendChild(el('div', { class: 'equip-card-header' }, [headerImg, el('div', { class: 'equip-card-title' }, cardTitle)]));

  const linkText = `Information prefilled from your Collections. To update it, please change it `;
  const link = el('a', {
    href: '#', class: 'equip-collection-link',
    onclick: (e) => { e.preventDefault(); goToCollectionSection(isMount ? 'mounts' : 'artifacts'); },
  }, 'here');
  card.appendChild(el('p', { class: 'equip-prefill-note' }, [linkText, link, '.']));

  card.appendChild(equipFieldLabel(cardTitle));
  if (!ownedItems.length) {
    card.appendChild(el('div', { class: 'equip-writeup' },
      `You haven't marked any ${isMount ? 'mounts' : 'artifacts'} as owned in Collection yet.`));
    return card;
  }

  const select = el('select', { class: 'equip-select' }, [
    el('option', { value: '' }, '— None —'),
    ...ownedItems.map(it => el('option', { value: String(it.idx), selected: it.idx === s.itemIdx ? 'true' : null }, it.n)),
  ]);
  select.addEventListener('change', (e) => {
    s.itemIdx = e.target.value ? parseInt(e.target.value, 10) : null;
    saveState();
    render();
  });
  card.appendChild(select);

  if (!item) return card;

  if (isAwakenMode) {
    const showAwaken = hasAwakenProgression(item);
    if (showAwaken) {
      card.appendChild(equipFieldLabel('Awaken'));
      card.appendChild(el('div', { class: 'equip-writeup' }, `A${itemState.awaken}`));
    }
    if (item.star_up) {
      const resolved = resolveAwakenEffect(item, showAwaken ? itemState.awaken : 0);
      card.appendChild(equipFieldLabel('Awaken Skill'));
      card.appendChild(el('div', { class: 'equip-writeup' }, resolved ? renderTextWithSkillTags(resolved.text) : '—'));
    }
  } else {
    const showStars = hasStarProgression(item);
    if (showStars) {
      card.appendChild(equipFieldLabel('Stars'));
      card.appendChild(el('div', { class: 'equip-writeup' }, `${itemState.stars}★`));
    }
    if (item.star_effects) {
      const starEff = showStars ? item.star_effects[String(itemState.stars)] : item.star_effects['0'];
      card.appendChild(equipFieldLabel('Skill'));
      card.appendChild(el('div', { class: 'equip-writeup' }, starEff ? renderTextWithSkillTags(starEff) : '—'));
    }
  }

  if (item.star_up) {
    const starDelta = itemState.stars > 0 ? item.star_up.deltas[String(itemState.stars)] : null;
    const awakenDelta = itemState.awaken > 0 ? item.awaken.deltas[`A${itemState.awaken}`] : null;
    const total = sumStatBlocks(item.awaken.base_stats, starDelta, awakenDelta);
    card.appendChild(equipFieldLabel('Current Stats'));
    card.appendChild(el('div', { class: 'equip-writeup' }, formatStatBlockNodes(total, true)));
  }

  return card;
}

// Arcana bonuses are cumulative (confirmed against the datamine's own
// comments) — so instead of listing "A0: ...", "A1: ...", etc as separate
// lines, sum same-named numeric bonuses across every level up to the
// selected one into one condensed line. Lines that don't end in a clean
// "+N%" (procs, stack counts, mid-sentence percentages) can't be summed
// meaningfully, so those pass through verbatim instead of being dropped.
function collateArcanaEffects(descs, upToIndex) {
  const totals = {};
  const order = [];
  const raw = [];
  for (let i = 0; i <= upToIndex && i < descs.length; i++) {
    const desc = descs[i];
    const m = desc.match(/^(.*?)\s*\+(\d+(?:\.\d+)?)%\s*(?:\(not tracked\))?$/);
    if (m) {
      const name = m[1].trim();
      const val = parseFloat(m[2]);
      if (!(name in totals)) { totals[name] = 0; order.push(name); }
      totals[name] += val;
    } else {
      raw.push(desc);
    }
  }
  const parts = order.map(name => `${name} +${Math.round(totals[name] * 100) / 100}%`);
  return [...parts, ...raw].join(', ');
}

function renderEquipCard(slotDef) {
  const s = getEquipState(slotDef.id);
  // Items with no tier assigned aren't real equippable gear — confirmed
  // safe to drop entirely rather than show under a catch-all "Other" group.
  const items = (DB[slotDef.dataKey] || []).filter(it => it.n !== 'None' && it.tier);
  const item = items.find(it => it.n === s.itemName) || null;

  const card = el('div', { class: 'equip-card' });

  // ---- Header: image + slot label ----
  const headerImg = item
    ? el('img', { src: itemImagePath(slotDef.imgKind, item), alt: item.n, class: 'equip-card-thumb', onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-card-thumb placeholder' });
  card.appendChild(el('div', { class: 'equip-card-header' }, [headerImg, el('div', { class: 'equip-card-title' }, slotDef.label)]));

  // ---- Equipped ----
  card.appendChild(equipFieldLabel('Equipped'));
  const tierOrder = ['SS', 'S', 'Basic'];
  const itemsByTier = {};
  items.forEach(it => { (itemsByTier[it.tier] = itemsByTier[it.tier] || []).push(it); });
  const orderedTiers = [...tierOrder.filter(t => itemsByTier[t]), ...Object.keys(itemsByTier).filter(t => !tierOrder.includes(t))];
  const equippedSelect = el('select', { class: 'equip-select' }, [
    el('option', { value: '' }, '— None —'),
    ...orderedTiers.map(tier => el('optgroup', { label: tier },
      itemsByTier[tier].map(it => el('option', { value: it.n, selected: it.n === s.itemName ? 'true' : null }, it.n)))),
  ]);
  equippedSelect.addEventListener('change', (e) => {
    s.itemName = e.target.value;
    const newItem = items.find(it => it.n === s.itemName);
    s.quality = newItem && newItem.q && newItem.q.length ? newItem.q[newItem.q.length - 1] : ''; // highest tier = last entry, usually Mythic
    s.surpass = 0;
    s.arcana = -1;
    saveState();
    render();
  });
  card.appendChild(equippedSelect);

  // Empty state: nothing past "Equipped" shows until an item is actually
  // selected — matches the reference card exactly.
  if (!item) return card;

  // ---- Quality ----
  card.appendChild(equipFieldLabel('Quality'));
  const qualOpts = item.q || [];
  const qualitySelect = el('select', { class: 'equip-select', disabled: qualOpts.length ? null : 'true' },
    qualOpts.length
      ? qualOpts.map(q => el('option', { value: q, selected: q === s.quality ? 'true' : null }, q))
      : [el('option', { value: '' }, '—')]);
  qualitySelect.addEventListener('change', (e) => { s.quality = e.target.value; saveState(); render(); });
  card.appendChild(qualitySelect);

  // ---- Surpass ----
  card.appendChild(equipFieldLabel('Surpass'));
  const surpassMax = item.surpass_max || 0;
  const surpassOpts = Array.from({ length: surpassMax + 1 }, (_, i) => i);
  const surpassSelect = el('select', { class: 'equip-select' },
    surpassOpts.map(n => el('option', { value: String(n), selected: n === s.surpass ? 'true' : null }, `+${n}`)));
  surpassSelect.addEventListener('change', (e) => { s.surpass = parseInt(e.target.value, 10); saveState(); render(); });
  card.appendChild(surpassSelect);

  // ---- Arcana ----
  card.appendChild(equipFieldLabel('Arcana'));
  const arcanaDescs = item.arcana_descs || [];
  const arcanaSelect = el('select', { class: 'equip-select', disabled: arcanaDescs.length ? null : 'true' }, [
    el('option', { value: '-1', selected: s.arcana === -1 ? 'true' : null }, 'No Arcana'),
    ...arcanaDescs.map((_, i) => el('option', { value: String(i), selected: i === s.arcana ? 'true' : null }, `A${i}`)),
  ]);
  arcanaSelect.addEventListener('change', (e) => { s.arcana = parseInt(e.target.value, 10); saveState(); render(); });
  card.appendChild(arcanaSelect);

  if (s.arcana >= 0 && arcanaDescs.length) {
    const collated = collateArcanaEffects(arcanaDescs, s.arcana);
    card.appendChild(el('div', { class: 'equip-arcana-writeup' }, collated));
  }

  // Psionic Attributes only ever roll on SS-tier gear — confirmed. Hide the
  // whole section rather than show it disabled/inapplicable for S/Basic.
  if (item.tier === 'SS') {
    card.appendChild(el('div', { class: 'equip-section-title' }, 'Psionic Attributes'));
    const psiOptions = DB.psionics[slotDef.psiKey] || [];
    s.psionics.forEach((slot, i) => {
      card.appendChild(equipFieldLabel(`Slot ${i + 1}`));
      card.appendChild(renderPsionicSlot(slotDef.id, i, slot, psiOptions, s.psionics));
    });
  }

  card.appendChild(el('hr', { class: 'equip-divider' }));

  // ---- Gems ----
  card.appendChild(el('div', { class: 'equip-section-title' }, 'Gems'));
  const gemOptions = DB.gems[slotDef.gemKey] || [];
  s.gems.forEach((slot, i) => {
    card.appendChild(equipFieldLabel(`Slot ${i + 1}`));
    card.appendChild(renderGemSlot(slotDef.id, i, slot, gemOptions, s.gems));
  });

  return card;
}

function equipFieldLabel(text) {
  return el('div', { class: 'equip-field-label' }, text);
}

function psiOptionLabel(o) {
  return `${o.n} — ${o.k === 'n' ? 'Normal' : 'Special'}`;
}

function renderPsionicSlot(slotId, slotIdx, slotState, options, allSlots) {
  const wrap = el('div', { class: 'equip-inline-row' });

  // Normal options first, then Special — folded into the visible label
  // since there's no dropdown grouping in a custom combo the way <select>
  // has <optgroup> ("Stat Name — Normal" / "— Special").
  const sortedOptions = [...options].sort((a, b) => (a.k === b.k ? 0 : a.k === 'n' ? -1 : 1));

  // A stat can only be rolled once across the 4 slots on one item, and at
  // most 2 of the 4 can be "Special" category stats — matching the game's
  // real roll rules, not just a UI nicety.
  const usedStatsElsewhere = new Set(allSlots.filter((_, i) => i !== slotIdx).map(sl => sl.stat).filter(Boolean));
  const specialsElsewhere = allSlots.filter((sl, i) => i !== slotIdx && sl.stat
    && (options.find(o => o.c === sl.stat) || {}).k === 's').length;
  const specialsCapped = specialsElsewhere >= 2;
  const availableOptions = sortedOptions.filter(o => !usedStatsElsewhere.has(o.c) && !(specialsCapped && o.k === 's'));

  const currentMeta = options.find(o => o.c === slotState.stat);
  const combo = renderSearchCombo({
    value: currentMeta ? psiOptionLabel(currentMeta) : '',
    options: availableOptions.map(psiOptionLabel),
    placeholder: 'Search stat…',
    onSelect: (label) => {
      const match = availableOptions.find(o => psiOptionLabel(o) === label);
      if (match) { slotState.stat = match.c; saveState(); render(); }
    },
    onClear: () => { slotState.stat = ''; saveState(); render(); },
  });

  const isSpeed = currentMeta && currentMeta.n === 'Speed'; // flat number, not a percentage
  const valInput = el('input', {
    type: 'number', class: 'equip-num-input' + (isSpeed ? ' equip-num-input-standalone' : ''), min: '0', placeholder: '0',
    value: slotState.val ? String(slotState.val) : '',
    oninput: (e) => {
      const n = parseFloat(e.target.value);
      // Negative rolls aren't a real state in-game — clamp rather than let
      // a negative value quietly sit in state, and flag the box red while
      // it's happening so it doesn't look like a silent no-op.
      if (n < 0) {
        e.target.classList.add('input-error');
        return;
      }
      e.target.classList.remove('input-error');
      slotState.val = Number.isNaN(n) ? 0 : n;
      saveState();
    },
    onblur: (e) => { e.target.classList.remove('input-error'); render(); },
  });

  wrap.appendChild(combo);
  wrap.appendChild(el('div', { class: 'equip-pct-input-group' }, isSpeed ? [valInput] : [valInput, el('span', {}, '%')]));

  const container = el('div', {}, [wrap]);
  if (slotState.stat) {
    const meta = options.find(o => o.c === slotState.stat);
    const suffix = meta && meta.n === 'Speed' ? '' : '%';
    container.appendChild(el('div', { class: 'equip-writeup' }, `${meta ? meta.n : slotState.stat} +${slotState.val}${suffix}`));
  }
  return container;
}

function renderGemSlot(slotId, slotIdx, slotState, options, allSlots) {
  const wrap = el('div', { class: 'equip-inline-row' });

  // A gem type can only be socketed once per item — having the same stat at
  // two different rarities on one weapon doesn't make sense. Exclude gems
  // already placed in any OTHER slot on this same card from this slot's
  // search results.
  const usedElsewhere = new Set(allSlots.filter((_, i) => i !== slotIdx).map(sl => sl.gemId).filter(Boolean));
  const availableOptions = options.filter(o => !usedElsewhere.has(o.id));

  // Gem names are baked with their Peerless (max-tier) numbers, but the
  // helper text below shows the number for whichever tier is actually
  // selected — those two numbers only match at Peerless. Showing both at
  // once looks like conflicting data, so the dropdown masks its own number
  // to X% and lets the helper text underneath be the one real source of
  // the actual selected-tier value. Confirmed no two gems in any slot
  // collide once masked, so matching on the masked label is still safe.
  const maskGemName = (name) => name.replace(/\d+(\.\d+)?%/g, 'X%');

  const combo = renderSearchCombo({
    value: slotState.gemId ? maskGemName((options.find(o => o.id === slotState.gemId) || {}).n || '') : '',
    options: availableOptions.map(o => maskGemName(o.n)),
    placeholder: 'Search gem…',
    onSelect: (maskedName) => {
      const match = availableOptions.find(o => maskGemName(o.n) === maskedName);
      if (!match) return;
      slotState.gemId = match.id;
      if (!slotState.tier) slotState.tier = 9; // default Peerless — every gem's data now runs the full 9 tiers
      saveState();
      render();
    },
    onClear: () => { slotState.gemId = ''; saveState(); render(); },
  });

  const tierSelect = el('select', { class: 'equip-select equip-tier-select', disabled: slotState.gemId ? null : 'true' },
    GEM_TIER_NAMES.map((name, i) => el('option', { value: String(i + 1), selected: (i + 1) === slotState.tier ? 'true' : null }, name)));
  tierSelect.addEventListener('change', (e) => { slotState.tier = parseInt(e.target.value, 10); saveState(); render(); });

  const tierIcon = slotState.gemId
    ? el('img', { class: 'equip-gem-tier-icon', src: `assets/images/gem_tiers/${slugify(GEM_TIER_NAMES[slotState.tier - 1])}.webp`, onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-gem-tier-icon placeholder' });

  wrap.appendChild(combo);
  wrap.appendChild(tierSelect);
  wrap.appendChild(tierIcon);

  const container = el('div', {}, [wrap]);
  if (slotState.gemId) {
    const meta = options.find(o => o.id === slotState.gemId);
    if (meta) {
      // tier_desc carries the real per-tier wording straight from source —
      // e.g. "Increased Damage to Shielded Targets +40%" at Transcendent —
      // rather than a generic short name + computed percentage, which for
      // most gems (the ones with no clean numeric value, only a described
      // effect) was never accurate to begin with.
      const realText = meta.tier_desc && meta.tier_desc[slotState.tier];
      if (realText) {
        container.appendChild(el('div', { class: 'equip-writeup' }, renderTextWithSkillTags(realText)));
      } else if (meta.t && meta.t[slotState.tier - 1] != null) {
        container.appendChild(el('div', { class: 'equip-writeup' }, `${meta.n} +${meta.t[slotState.tier - 1]}%`));
      } else {
        container.appendChild(el('div', { class: 'equip-writeup placeholder' }, 'No effect documented at this tier.'));
      }
    }
  }
  return container;
}

let scrollObserver;

function render() {
  root.innerHTML = '';
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }

  if (activeMainTab === 'collection') {
    root.appendChild(renderCollectionShell());
  } else if (activeMainTab === 'calculator') {
    root.appendChild(renderCalculator());
  } else if (activeMainTab === 'equipment') {
    root.appendChild(renderEquipmentShell());
  } else if (activeMainTab === 'inheritance') {
    root.appendChild(renderInheritanceShell());
  } else {
    const labels = { inheritance: 'Inheritance Tree' };
    root.appendChild(renderPlaceholder(labels[activeMainTab] || activeMainTab));
  }

  focusActiveStepperInput();
}

function renderSectionShell(sections) {
  const shell = el('div', { class: 'collection-shell' });

  // Click handler shared by all sidenav anchor links. Deliberately does NOT
  // rely on native <a href="#..."> navigation: on file:// pages, Chrome can
  // throw "Unsafe attempt to load URL ...#hash from frame with URL ...#hash"
  // and refuse to navigate, since it treats every file:// + fragment
  // combination as a distinct resource. Scrolling manually via JS sidesteps
  // that entirely and works identically once this is hosted for real too.
  function scrollToAnchor(e, id) {
    e.preventDefault();
    document.querySelector(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Desktop: sticky sidenav with anchor links (unchanged, hidden on mobile via CSS)
  const nav = el('nav', { class: 'sidenav' });
  const linksList = el('ul', { class: 'sidenav-links' });

  // Mobile: native <select> — big native touch target, immune to the
  // fixed-position/z-index overlap bugs a custom drawer toggle can hit.
  const mobileSelect = el('select', {
    class: 'mobile-section-select',
    onchange: (e) => {
      const id = e.target.value;
      if (id) document.querySelector(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      e.target.selectedIndex = 0;
    },
  });
  mobileSelect.appendChild(el('option', { value: '' }, 'Jump to section…'));

  sections.forEach(sec => {
    const li = el('li', {});
    li.appendChild(el('a', { href: `#${sec.id}`, class: 'sidenav-link', onclick: (e) => scrollToAnchor(e, `#${sec.id}`) }, sec.label));
    mobileSelect.appendChild(el('option', { value: `#${sec.id}` }, sec.label));

    if (sec.sub) {
      const groups = sec.sub();
      if (groups.length > 1) {
        const sub = el('ul', { class: 'sidenav-sublist' });
        groups.forEach(g => {
          const anchorId = `#${sec.id}-${g.slug}`;
          sub.appendChild(el('li', {}, el('a', {
            href: anchorId, class: 'sidenav-sublink', onclick: (e) => scrollToAnchor(e, anchorId),
          }, g.tier)));
          mobileSelect.appendChild(el('option', { value: anchorId }, `— ${sec.label}: ${g.tier}`));
        });
        li.appendChild(sub);
      }
    }
    linksList.appendChild(li);
  });
  nav.appendChild(linksList);

  const content = el('div', { class: 'collection-content' });
  sections.forEach(sec => {
    const section = el('section', { id: sec.id, class: 'page-section' });
    if (sec.clearAll) {
      section.appendChild(el('div', { class: 'section-title-row' }, [
        el('h2', { class: 'section-title' }, sec.label),
        renderClearAllButton(sec.label, sec.clearAll),
      ]));
    } else {
      section.appendChild(el('h2', { class: 'section-title' }, sec.label));
    }
    section.appendChild(sec.build());
    content.appendChild(section);
  });

  shell.appendChild(mobileSelect);
  shell.appendChild(nav);
  shell.appendChild(content);

  setupScrollSpy(nav);
  return shell;
}

function renderCollectionShell() {
  return renderSectionShell(COLLECTION_SECTIONS);
}

function setupScrollSpy(navEl) {
  if (typeof IntersectionObserver === 'undefined') return;
  const targets = document.querySelectorAll('.page-section, .tier-group-title[id]');
  scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const link = navEl.querySelector(`a[href="#${entry.target.id}"]`);
      if (!link) return;
      navEl.querySelectorAll('a.active').forEach(a => a.classList.remove('active'));
      link.classList.add('active');
    });
  }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
  targets.forEach(t => scrollObserver.observe(t));
}

/* ---------- Relics ---------- */
let relicSearch = '';
let relicRarityFilter = 'All';

function renderSetMemberIcon(kind, name) {
  const img = el('img', {
    src: itemImagePath(kind, { n: name }),
    alt: name,
    loading: 'lazy',
    onerror: (e) => { e.target.style.visibility = 'hidden'; },
  });
  return el('div', { class: 'set-member-icon' }, img);
}

function renderSetCard({ kind, name, statLabel, tierLabels, vals, members, allOwned, minStar, tierIdx }) {
  const ownedCount = members.filter(m => m.owned).length;

  const card = el('div', { class: 'set-card' });
  card.appendChild(el('div', { class: 'set-card-header' }, [
    el('div', { class: 'set-card-name' }, name),
    el('div', { class: 'set-card-count' + (ownedCount === members.length ? ' complete' : '') },
      `${ownedCount}/${members.length} owned`),
  ]));
  if (statLabel) card.appendChild(el('div', { class: 'set-card-stat-label' }, `Increases: ${statLabel}`));

  const memberList = el('div', { class: 'set-member-list' });
  members.forEach(m => {
    memberList.appendChild(el('div', { class: 'set-member-row' }, [
      el('div', { class: 'set-member-left' }, [
        renderSetMemberIcon(kind, m.name),
        el('div', { class: 'set-member-name' + (m.owned ? ' owned' : '') }, m.name),
      ]),
      el('div', { class: 'set-member-value' }, m.owned ? `${m.star}★` : '—'),
    ]));
  });
  card.appendChild(memberList);

  const tierGrid = el('div', { class: 'set-tier-grid' });
  vals.forEach((v, i) => {
    const reached = allOwned && i <= tierIdx;
    const active = allOwned && i === tierIdx;
    tierGrid.appendChild(el('div', { class: 'set-tier-pip2' + (reached ? ' reached' : '') + (active ? ' active' : '') }, [
      el('span', { class: 'pip-star' }, tierLabels[i]),
      el('span', { class: 'pip-val' }, `${v}${typeof v === 'number' && v < 20 ? '%' : ''}`),
    ]));
  });
  card.appendChild(tierGrid);

  return card;
}

/* ============================================================
   Bulk actions: per-tier "Own All", and cross-tier multi-select
   with a modal to assign a star level to many items at once.
   ============================================================ */
const BULK_CONFIG = {
  relics: {
    idKey: (it) => it.n,
    getOwned: (name) => !!state.relicOwned[name],
    getStar: (name) => state.relicStars[name] || 0,
    maxStar: () => 10,
    apply: (name, owned, star) => { state.relicOwned[name] = owned; state.relicStars[name] = star; },
  },
  collectibles: {
    idKey: (it) => it.n,
    getOwned: (name) => !!state.collectibleOwned[name],
    getStar: (name) => state.collectibleStars[name] || 0,
    maxStar: () => 10,
    apply: (name, owned, star) => { state.collectibleOwned[name] = owned; state.collectibleStars[name] = star; },
  },
  mounts: {
    idKey: (it) => it.idx,
    hasAwaken: true,
    getOwned: (idx) => !!(state.mountState[idx] && state.mountState[idx].owned),
    getStar: (idx) => (state.mountState[idx] && state.mountState[idx].stars) || 0,
    getAwaken: (idx) => (state.mountState[idx] && state.mountState[idx].awaken) || 0,
    maxStar: () => 5,
    maxAwaken: () => 10,
    apply: (idx, owned, star, awaken) => {
      const s = getMountOrArtifactState('mountState', idx);
      s.owned = owned;
      if (star !== undefined) s.stars = star;
      if (awaken !== undefined) s.awaken = awaken;
    },
  },
  artifacts: {
    idKey: (it) => it.idx,
    hasAwaken: true,
    getOwned: (idx) => !!(state.artifactState[idx] && state.artifactState[idx].owned),
    getStar: (idx) => (state.artifactState[idx] && state.artifactState[idx].stars) || 0,
    getAwaken: (idx) => (state.artifactState[idx] && state.artifactState[idx].awaken) || 0,
    maxStar: () => 5,
    maxAwaken: () => 10,
    apply: (idx, owned, star, awaken) => {
      const s = getMountOrArtifactState('artifactState', idx);
      s.owned = owned;
      if (star !== undefined) s.stars = star;
      if (awaken !== undefined) s.awaken = awaken;
    },
  },
};

const selectMode = { relics: false, collectibles: false, mounts: false, artifacts: false };
const selectedItems = { relics: new Set(), collectibles: new Set(), mounts: new Set(), artifacts: new Set() };

function renderTierGroupHeader(kind, tierLabel, groupId, groupItems) {
  const cfg = BULK_CONFIG[kind];
  const allSelected = groupItems.length > 0 && groupItems.every(it => selectedItems[kind].has(cfg.idKey(it)));

  const header = el('div', { class: 'tier-group-header' });
  header.appendChild(el('div', { class: 'tier-group-title', id: groupId, style: 'margin:0;border:none;padding:0;' }, tierLabel));

  // Bulk-selecting a tier only makes sense when there's more than one item
  // in it — with just one, "Select Tier" is a pointless extra step before
  // doing exactly what tapping the item directly would do.
  if (groupItems.length > 1) {
    const btnRow = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
    btnRow.appendChild(el('button', {
      class: 'bulk-action-btn',
      onclick: () => {
        if (allSelected) {
          // Deselect just this tier's items, leaving any others untouched
          groupItems.forEach(it => selectedItems[kind].delete(cfg.idKey(it)));
        } else {
          // Select ONLY this tier — replaces whatever was selected before
          // (selection is always scoped to one tier at a time), and
          // auto-enters selection mode so this button alone is enough to
          // get to the Mark Owned / Star Update actions without a separate
          // "Select multiple…" toggle first.
          selectMode[kind] = true;
          selectedItems[kind] = new Set(groupItems.map(cfg.idKey));
        }
        render();
      },
    }, allSelected ? 'Deselect Tier' : 'Select Tier'));
    header.appendChild(btnRow);
  }

  return header;
}

function toggleSelectMode(kind) {
  selectMode[kind] = !selectMode[kind];
  if (!selectMode[kind]) selectedItems[kind].clear();
  render();
}

function toggleItemSelected(kind, id) {
  const set = selectedItems[kind];
  if (set.has(id)) set.delete(id); else set.add(id);
  render();
}

function renderBulkActionBar(kind) {
  const count = selectedItems[kind].size;
  if (!selectMode[kind]) return null;
  const cfg = BULK_CONFIG[kind];
  return el('div', { class: 'bulk-action-bar' }, [
    el('span', { class: 'bulk-action-count' }, count > 0 ? `${count} selected` : 'Tap items or "Select Tier" to select them'),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
      el('button', {
        class: 'bulk-action-btn',
        disabled: count === 0 ? 'true' : null,
        onclick: () => {
          if (count === 0) return;
          [...selectedItems[kind]].forEach(id => cfg.apply(id, true, cfg.getStar(id), cfg.hasAwaken ? cfg.getAwaken(id) : undefined));
          saveState();
          render();
        },
      }, 'Mark as Owned'),
      el('button', {
        class: 'bulk-action-btn',
        disabled: count === 0 ? 'true' : null,
        onclick: () => { if (count > 0) { cfg.hasAwaken ? openStarAwakenModal(kind) : openStarAssignModal(kind); } },
      }, cfg.hasAwaken ? 'Star & Awaken Update' : 'Star Update'),
      el('button', { class: 'bulk-action-btn secondary', onclick: () => toggleSelectMode(kind) }, 'Done'),
    ]),
  ]);
}

function openStarAwakenModal(kind) {
  const cfg = BULK_CONFIG[kind];
  const ids = [...selectedItems[kind]];
  const dataKey = kind === 'mounts' ? 'mounts' : 'artifacts';
  const itemsById = Object.fromEntries(DB[dataKey].map(it => [it.idx, it]));
  const maxStar = cfg.maxStar();
  const maxAwaken = cfg.maxAwaken();
  let starVal = maxStar;
  let awakenVal = maxAwaken;

  // Uncommon/Rare/Epic mounts have no real star progression, and at least
  // one artifact (Sword of Victory Oath) has neither stars nor awaken —
  // both confirmed by every delta being empty for those items. Showing a
  // picker for a dimension that does nothing is just confusing. Bulk
  // selection is always scoped to a single tier at a time, so this only
  // ever needs to check the first selected item.
  const firstItem = ids.length ? itemsById[ids[0]] : null;
  const showStars = !firstItem || hasStarProgression(firstItem);
  const showAwaken = !firstItem || hasAwakenProgression(firstItem);

  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } });

  const starDisplay = el('div', { class: 'modal-star-value' }, `${starVal}★`);
  const starInput = el('input', {
    type: 'number', class: 'modal-star-input', min: '0', max: String(maxStar), value: String(starVal),
    oninput: (e) => {
      const n = parseInt(e.target.value, 10);
      starVal = Number.isNaN(n) ? 0 : Math.max(0, Math.min(maxStar, n));
      starDisplay.textContent = `${starVal}★`;
    },
  });
  const awakenDisplay = el('div', { class: 'modal-star-value' }, `A${awakenVal}`);
  const awakenInput = el('input', {
    type: 'number', class: 'modal-star-input', min: '0', max: String(maxAwaken), value: String(awakenVal),
    oninput: (e) => {
      const n = parseInt(e.target.value, 10);
      awakenVal = Number.isNaN(n) ? 0 : Math.max(0, Math.min(maxAwaken, n));
      awakenDisplay.textContent = `A${awakenVal}`;
    },
  });

  const titleParts = [];
  if (showStars) titleParts.push('stars');
  if (showAwaken) titleParts.push('awaken');
  const box = el('div', { class: 'modal-box' }, [
    el('div', { class: 'modal-title' }, titleParts.length
      ? `Set ${titleParts.join(' & ')} for ${ids.length} item${ids.length === 1 ? '' : 's'}`
      : `Nothing to set for ${ids.length} item${ids.length === 1 ? '' : 's'}`),
    showStars ? el('div', { class: 'modal-input-label', style: 'text-align:center;margin-bottom:6px;' }, 'Stars') : null,
    showStars ? el('div', { class: 'modal-star-picker' }, [
      el('button', { class: 'modal-star-btn', onclick: () => { starVal = Math.max(0, starVal - 1); starDisplay.textContent = `${starVal}★`; starInput.value = String(starVal); } }, '−'),
      starDisplay,
      el('button', { class: 'modal-star-btn', onclick: () => { starVal = Math.min(maxStar, starVal + 1); starDisplay.textContent = `${starVal}★`; starInput.value = String(starVal); } }, '+'),
    ]) : null,
    showStars ? el('div', { class: 'modal-input-row' }, [el('span', { class: 'modal-input-label' }, 'or type a number:'), starInput]) : null,
    showAwaken ? el('div', { class: 'modal-input-label', style: `text-align:center;margin:${showStars ? '14px' : '0'} 0 6px;` }, 'Awaken') : null,
    showAwaken ? el('div', { class: 'modal-star-picker' }, [
      el('button', { class: 'modal-star-btn', onclick: () => { awakenVal = Math.max(0, awakenVal - 1); awakenDisplay.textContent = `A${awakenVal}`; awakenInput.value = String(awakenVal); } }, '−'),
      awakenDisplay,
      el('button', { class: 'modal-star-btn', onclick: () => { awakenVal = Math.min(maxAwaken, awakenVal + 1); awakenDisplay.textContent = `A${awakenVal}`; awakenInput.value = String(awakenVal); } }, '+'),
    ]) : null,
    showAwaken ? el('div', { class: 'modal-input-row' }, [el('span', { class: 'modal-input-label' }, 'or type a number:'), awakenInput]) : null,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'bulk-action-btn secondary', onclick: closeModal }, 'Cancel'),
      el('button', {
        class: 'bulk-action-btn primary',
        onclick: () => {
          ids.forEach(id => cfg.apply(id, true, showStars ? starVal : undefined, showAwaken ? awakenVal : undefined));
          saveState();
          selectedItems[kind].clear();
          selectMode[kind] = false;
          closeModal();
          render();
        },
      }, 'Apply'),
    ]),
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function closeModal() { overlay.remove(); }
}

function openStarAssignModal(kind) {
  const cfg = BULK_CONFIG[kind];
  const names = [...selectedItems[kind]];
  const itemsByName = Object.fromEntries((kind === 'relics' ? DB.relics : DB.collectibles).map(it => [it.n, it]));
  const maxAllowed = Math.min(...names.map(n => cfg.maxStar(itemsByName[n])));
  let value = maxAllowed;

  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } });
  const valDisplay = el('div', { class: 'modal-star-value' }, `${value}★`);
  const numInput = el('input', {
    type: 'number', class: 'modal-star-input', min: '0', max: String(maxAllowed), value: String(value),
    oninput: (e) => {
      const n = parseInt(e.target.value, 10);
      value = Number.isNaN(n) ? 0 : Math.max(0, Math.min(maxAllowed, n));
      valDisplay.textContent = `${value}★`;
    },
  });

  const box = el('div', { class: 'modal-box' }, [
    el('div', { class: 'modal-title' }, `Set stars for ${names.length} item${names.length === 1 ? '' : 's'}`),
    el('div', { class: 'modal-star-picker' }, [
      el('button', { class: 'modal-star-btn', onclick: () => { value = Math.max(0, value - 1); valDisplay.textContent = `${value}★`; numInput.value = String(value); } }, '−'),
      valDisplay,
      el('button', { class: 'modal-star-btn', onclick: () => { value = Math.min(maxAllowed, value + 1); valDisplay.textContent = `${value}★`; numInput.value = String(value); } }, '+'),
    ]),
    el('div', { class: 'modal-input-row' }, [
      el('span', { class: 'modal-input-label' }, 'or type a number:'),
      numInput,
    ]),
    maxAllowed < 10 ? el('div', { class: 'modal-note' }, `Capped at ${maxAllowed}★ — the lowest max among your selected items.`) : null,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'bulk-action-btn secondary', onclick: closeModal }, 'Cancel'),
      el('button', {
        class: 'bulk-action-btn primary',
        onclick: () => {
          names.forEach(n => cfg.apply(n, true, Math.min(value, cfg.maxStar(itemsByName[n]))));
          saveState();
          selectedItems[kind].clear();
          selectMode[kind] = false;
          closeModal();
          render();
        },
      }, 'Apply'),
    ]),
  ]);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function closeModal() { overlay.remove(); }
}

function clearAllRelics() {
  state.relicOwned = {};
  state.relicStars = {};
  saveState();
  render();
}

function renderRelics() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'You may filter relics by tier, multi-select them and either mark them as owned or assign stars to the selection. Relics marked as owned here will be selectable in the equipments page.'));

  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: 'Search relics…', value: relicSearch,
    oninput: (e) => { relicSearch = e.target.value; renderRelicGroups(groupsWrap); },
  });
  toolbar.appendChild(search);
  ['All', 'Rare', 'Epic', 'Legendary', 'Mythic'].forEach(r => {
    const chip = el('button', {
      class: 'filter-chip' + (relicRarityFilter === r ? ' active' : ''),
      onclick: () => {
        relicRarityFilter = r;
        toolbar.querySelectorAll('.filter-chip[data-tier]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderRelicGroups(groupsWrap);
      },
    }, r);
    chip.dataset.tier = 'true';
    toolbar.appendChild(chip);
  });
  toolbar.appendChild(el('button', {
    class: 'filter-chip' + (selectMode.relics ? ' active' : ''),
    onclick: () => toggleSelectMode('relics'),
  }, selectMode.relics ? 'Cancel selecting' : 'Select multiple…'));
  wrap.appendChild(toolbar);

  const groupsWrap = el('div', {});
  wrap.appendChild(groupsWrap);
  renderRelicGroups(groupsWrap);

  // Sets, at the bottom
  wrap.appendChild(el('div', { class: 'tier-group-title' }, 'Relic Sets'));
  const setsGrid = el('div', { class: 'sets-grid' });
  const allSets = Object.values(DB.relic_sets).flat();
  allSets.forEach(set => setsGrid.appendChild(renderRelicSetPanel(set)));
  wrap.appendChild(setsGrid);

  return wrap;
}

function renderRelicGroups(container) {
  container.innerHTML = '';
  const items = DB.relics.filter(r => {
    if (relicRarityFilter !== 'All' && r.rarity !== relicRarityFilter) return false;
    if (relicSearch && !r.n.toLowerCase().includes(relicSearch.toLowerCase())) return false;
    return true;
  });
  const groups = buildTierGroups(items, 'rarity');
  groups.forEach(g => {
    container.appendChild(renderTierGroupHeader('relics', g.tier, `relics-${g.slug}`, g.items));
    const grid = el('div', { class: 'card-grid cols-3' });
    g.items.forEach(r => grid.appendChild(renderRelicCard(r)));
    container.appendChild(grid);
  });
  const bar = renderBulkActionBar('relics');
  if (bar) container.appendChild(bar);
}

function renderSelectionOverlay(kind, name) {
  const selected = selectedItems[kind].has(name);
  return el('button', {
    type: 'button',
    class: 'select-checkbox' + (selected ? ' checked' : ''),
    onclick: (e) => { e.stopPropagation(); toggleItemSelected(kind, name); },
  }, selected ? '✓' : '');
}

function renderRelicCard(relic) {
  const owned = !!state.relicOwned[relic.n];
  const star = state.relicStars[relic.n] || 0;

  const card = el('div', { class: `item-card r-${relic.rarity}` + (selectMode.relics && selectedItems.relics.has(relic.n) ? ' selected' : '') });
  if (selectMode.relics) card.appendChild(renderSelectionOverlay('relics', relic.n));
  card.appendChild(el('div', { class: 'card-header-row' }, [
    el('div', { class: 'header-left' }, [
      renderThumb('relics', relic),
      el('div', { class: 'item-name' }, relic.n),
    ]),
  ]));
  card.appendChild(el('div', { class: 'item-rarity' }, relic.rarity));

  const stepper = renderStepper(
    `relic-${relic.n}`, star, 0, 10,
    (next) => setRelicStar(relic.n, next),
    (v) => `${v}★`
  );
  card.appendChild(el('div', { class: 'card-controls-row' }, [
    renderOwnedBadge(owned, (checked) => {
      state.relicOwned[relic.n] = checked;
      if (!checked) state.relicStars[relic.n] = 0;
      saveState();
      render();
    }),
    el('div', { class: 'steppers-col' }, [stepper]),
  ]));

  if (owned) {
    // Relics with base/5★/10★ effect text (35 of them, from the "Relic
    // Equip effect" sheet) should show whichever tier actually matches the
    // current star level — not always the 10★ version regardless of where
    // the star stepper actually sits. Relics with only a single "effect"
    // field (no tiered variants) keep showing that one either way, since
    // it's all the source data has.
    let effectText = relic.effect;
    let effectLabel = '10★';
    if (relic.effect_base) {
      if (star < 5) { effectText = relic.effect_base; effectLabel = '0★'; }
      else if (star < 10) { effectText = relic.effect_5star; effectLabel = '5★'; }
      else { effectText = relic.effect; effectLabel = '10★'; }
    }
    if (effectText) {
      card.appendChild(el('div', { class: 'item-effect' },
        el('span', {}, [`${effectLabel}: `, renderTextWithSkillTags(effectText)])));
    }

    if (relic.star_stats) {
      const nodes = formatStatBlockNodes(
        Object.fromEntries(Object.entries(relic.star_stats).map(([stat, vals]) => [stat, vals[star]]))
      );
      card.appendChild(el('div', { class: 'item-effect' }, nodes));
    }
  }

  return card;
}

function setRelicStar(relicName, next) {
  state.relicStars[relicName] = next;
  if (next > 0) state.relicOwned[relicName] = true;
  saveState();
  render();
}

const RELIC_TIER_STARS = [0, 2, 4, 6, 8, 10];
const RELIC_TIER_LABELS = ['Set', '2★', '4★', '6★', '8★', '10★'];

function renderRelicSetPanel(set) {
  const memberRelics = set.items.map(name => DB.relics.find(r => r.n === name)).filter(Boolean);
  const allOwned = memberRelics.length > 0 && memberRelics.every(r => state.relicOwned[r.n]);
  const minStar = allOwned ? Math.min(...memberRelics.map(r => state.relicStars[r.n] || 0)) : -1;

  let tierIdx = -1;
  if (allOwned) {
    tierIdx = 0;
    for (let i = RELIC_TIER_STARS.length - 1; i >= 0; i--) {
      if (minStar >= RELIC_TIER_STARS[i]) { tierIdx = i; break; }
    }
  }

  const members = memberRelics.map(r => ({
    name: r.n,
    owned: !!state.relicOwned[r.n],
    star: state.relicStars[r.n] || 0,
  }));

  return renderSetCard({
    kind: 'relics', name: set.set, statLabel: set.stat,
    tierLabels: RELIC_TIER_LABELS, vals: set.vals,
    members, allOwned, minStar, tierIdx,
  });
}

/* ---------- Collectibles ---------- */
let collectibleSearch = '';
let collectibleRarityFilter = 'All';

function clearAllCollectibles() {
  state.collectibleOwned = {};
  state.collectibleStars = {};
  saveState();
  render();
}

function renderCollectibles() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'You may filter collectibles by tier, multi-select them and either mark them as owned or assign stars to the selection.'));

  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: 'Search collectibles…', value: collectibleSearch,
    oninput: (e) => { collectibleSearch = e.target.value; renderCollectibleGroups(groupsWrap); },
  });
  toolbar.appendChild(search);
  ['All', 'Epic', 'Legendary', 'Mythic'].forEach(r => {
    const chip = el('button', {
      class: 'filter-chip' + (collectibleRarityFilter === r ? ' active' : ''),
      onclick: () => {
        collectibleRarityFilter = r;
        toolbar.querySelectorAll('.filter-chip[data-tier]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderCollectibleGroups(groupsWrap);
      },
    }, r);
    chip.dataset.tier = 'true';
    toolbar.appendChild(chip);
  });
  toolbar.appendChild(el('button', {
    class: 'filter-chip' + (selectMode.collectibles ? ' active' : ''),
    onclick: () => toggleSelectMode('collectibles'),
  }, selectMode.collectibles ? 'Cancel selecting' : 'Select multiple…'));
  wrap.appendChild(toolbar);

  const groupsWrap = el('div', {});
  wrap.appendChild(groupsWrap);
  renderCollectibleGroups(groupsWrap);

  wrap.appendChild(el('div', { class: 'tier-group-title' }, 'Collectible Sets'));
  const setsGrid = el('div', { class: 'sets-grid' });
  const allSets = Object.values(DB.collectible_sets).flat();
  allSets.forEach(set => setsGrid.appendChild(renderCollectibleSetPanel(set)));
  wrap.appendChild(setsGrid);

  return wrap;
}

function renderCollectibleGroups(container) {
  container.innerHTML = '';
  const items = DB.collectibles.filter(c => {
    if (collectibleRarityFilter !== 'All' && c.rarity !== collectibleRarityFilter) return false;
    if (collectibleSearch && !c.n.toLowerCase().includes(collectibleSearch.toLowerCase())) return false;
    return true;
  });
  const groups = buildTierGroups(items, 'rarity');
  groups.forEach(g => {
    container.appendChild(renderTierGroupHeader('collectibles', g.tier, `collectibles-${g.slug}`, g.items));
    const grid = el('div', { class: 'card-grid cols-3' });
    g.items.forEach(c => grid.appendChild(renderCollectibleCard(c)));
    container.appendChild(grid);
  });
  const bar = renderBulkActionBar('collectibles');
  if (bar) container.appendChild(bar);
}

function renderCollectibleCard(item) {
  const owned = !!state.collectibleOwned[item.n];
  const maxStar = 10;
  const stars = Math.min(state.collectibleStars[item.n] || 0, maxStar);
  const card = el('div', { class: `item-card r-${item.rarity}` + (selectMode.collectibles && selectedItems.collectibles.has(item.n) ? ' selected' : '') });
  if (selectMode.collectibles) card.appendChild(renderSelectionOverlay('collectibles', item.n));
  card.appendChild(el('div', { class: 'card-header-row' }, [
    el('div', { class: 'header-left' }, [
      renderThumb('collectibles', item),
      el('div', { class: 'item-name' }, item.n),
    ]),
  ]));
  card.appendChild(el('div', { class: 'item-rarity' },
    item.rarity + (item.set ? ' · Set: ' + item.set : '')));

  const stepper = renderStepper(
    `collectible-${item.n}`, stars, 0, maxStar,
    (next) => setCollectibleStar(item.n, next, maxStar),
    (v) => `${v}★`
  );
  card.appendChild(el('div', { class: 'card-controls-row' }, [
    renderOwnedBadge(owned, (checked) => {
      state.collectibleOwned[item.n] = checked;
      if (!checked) state.collectibleStars[item.n] = 0;
      saveState();
      render();
    }),
    el('div', { class: 'steppers-col' }, [stepper]),
  ]));

  if (owned) {
    const val = item.star_vals[stars];
    if (val == null) {
      card.appendChild(el('div', { class: 'item-effect placeholder' },
        `${item.stat_label}: not documented at ${stars}★ yet`));
    } else {
      // New source data gives raw numbers directly (percent stats are
      // already whole percentages like 1.0 = 1%, not a 0.01 fraction) —
      // no more ×100 conversion, and flat stats (HP/ATK/DEF/Block) get no
      // "%" at all since they're not percentages to begin with.
      const display = item.is_percent ? `${val}%` : `${val}`;
      card.appendChild(el('div', { class: 'item-effect' }, [
        item.stat_label.replace(/\s*%$/, '') + ': ',
        el('span', { class: 'stat-value-live' }, display),
      ]));
    }
  }
  return card;
}

function setCollectibleStar(name, next, maxStar) {
  state.collectibleStars[name] = Math.max(0, Math.min(maxStar != null ? maxStar : 10, next));
  if (next > 0) state.collectibleOwned[name] = true;
  saveState();
  render();
}

const COLLECTIBLE_TIER_STARS = [0, 3, 6, 10];
const COLLECTIBLE_TIER_LABELS = ['0★', '3★', '6★', '10★'];

function renderCollectibleSetPanel(set) {
  const allOwned = set.items.every(name => state.collectibleOwned[name]);
  const minStar = allOwned ? Math.min(...set.items.map(name => state.collectibleStars[name] || 0)) : -1;
  let tierIdx = 0;
  if (allOwned) {
    for (let i = COLLECTIBLE_TIER_STARS.length - 1; i >= 0; i--) {
      if (minStar >= COLLECTIBLE_TIER_STARS[i]) { tierIdx = i; break; }
    }
  }

  const members = set.items.map(name => ({
    name,
    owned: !!state.collectibleOwned[name],
    star: state.collectibleStars[name] || 0,
  }));

  return renderSetCard({
    kind: 'collectibles', name: set.set, statLabel: set.stat,
    tierLabels: COLLECTIBLE_TIER_LABELS, vals: set.vals,
    members, allOwned, minStar, tierIdx: allOwned ? tierIdx : -1,
  });
}

/* ---------- Mounts & Artifacts ---------- */
const TIER_ORDER = ['Transcendent', 'Immortal', 'Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Great', 'Common'];

// Highest tier first, matching TIER_ORDER — used anywhere a dropdown or
// search list needs items sorted by tier rather than left in whatever
// order they happened to load from the source data.
function sortByTierDesc(items, field = 'tier') {
  return [...items].sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a[field]);
    const bi = TIER_ORDER.indexOf(b[field]);
    return (ai === -1 ? TIER_ORDER.length : ai) - (bi === -1 ? TIER_ORDER.length : bi);
  });
}

const mountArtifactFilters = {
  mounts: { search: '', tier: 'All', owned: 'All' },
  artifacts: { search: '', tier: 'All', owned: 'All' },
};

function clearAllMountsOrArtifacts(kind) {
  const bucketKey = kind === 'mounts' ? 'mountState' : 'artifactState';
  state[bucketKey] = {};
  saveState();
  render();
}

function renderMountsOrArtifacts(kind) {
  const isMount = kind === 'mounts';
  const bucket = isMount ? 'mountState' : 'artifactState';
  const filters = mountArtifactFilters[kind];

  const wrap = el('div', { class: isMount ? 'scope-mounts' : '' });
  wrap.appendChild(el('p', { class: 'section-desc' },
    isMount
      ? 'You may filter mounts by tier, multi-select them and either mark them as owned or assign stars to the selection. Mounts marked as owned here will be selectable in the equipments page.'
      : 'You may filter artifacts by tier, multi-select them and either mark them as owned or assign stars to the selection. Artifacts marked as owned here will be selectable in the equipments page.'));

  const toolbar = el('div', { class: 'toolbar toolbar-stacked' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: `Search ${kind}…`, value: filters.search,
    oninput: (e) => { filters.search = e.target.value; renderMountArtifactGroups(kind, groupsWrap); },
  });
  toolbar.appendChild(search);

  const tierRow = el('div', { class: 'toolbar-row' });
  tierRow.appendChild(el('span', { class: 'toolbar-row-label' }, 'Tier'));
  const allItems = (isMount ? DB.mounts : DB.artifacts).filter(x => x.n !== 'None');
  const tierOptions = ['All', ...buildTierGroups(allItems).map(g => g.tier)];
  tierOptions.forEach(t => {
    const chip = el('button', {
      class: 'filter-chip' + (filters.tier === t ? ' active' : ''),
      onclick: () => {
        filters.tier = t;
        tierRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderMountArtifactGroups(kind, groupsWrap);
      },
    }, t);
    tierRow.appendChild(chip);
  });
  toolbar.appendChild(tierRow);

  const ownedRow = el('div', { class: 'toolbar-row' });
  ownedRow.appendChild(el('span', { class: 'toolbar-row-label' }, 'Owned'));
  ['All', 'Owned', 'Not Owned'].forEach(o => {
    const chip = el('button', {
      class: 'filter-chip' + (filters.owned === o ? ' active' : ''),
      onclick: () => {
        filters.owned = o;
        ownedRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderMountArtifactGroups(kind, groupsWrap);
      },
    }, o);
    ownedRow.appendChild(chip);
  });
  ownedRow.appendChild(el('button', {
    class: 'filter-chip' + (selectMode[kind] ? ' active' : ''),
    onclick: () => toggleSelectMode(kind),
  }, selectMode[kind] ? 'Cancel selecting' : 'Select multiple…'));
  toolbar.appendChild(ownedRow);
  wrap.appendChild(toolbar);

  const groupsWrap = el('div', {});
  wrap.appendChild(groupsWrap);
  renderMountArtifactGroups(kind, groupsWrap);

  return wrap;
}

function renderMountArtifactGroups(kind, container) {
  container.innerHTML = '';
  const isMount = kind === 'mounts';
  const bucket = isMount ? 'mountState' : 'artifactState';
  const filters = mountArtifactFilters[kind];

  const allItems = (isMount ? DB.mounts : DB.artifacts).filter(it => it.n !== 'None');
  const items = allItems.filter(it => {
    if (filters.tier !== 'All' && it.tier !== filters.tier) return false;
    if (filters.search && !it.n.toLowerCase().includes(filters.search.toLowerCase())) return false;
    const owned = !!(state[bucket][it.idx] && state[bucket][it.idx].owned);
    if (filters.owned === 'Owned' && !owned) return false;
    if (filters.owned === 'Not Owned' && owned) return false;
    return true;
  });

  const groups = buildTierGroups(items);
  groups.forEach(g => {
    container.appendChild(renderTierGroupHeader(kind, g.tier, `${kind}-${g.slug}`, g.items));
    const grid = el('div', { class: 'card-grid cols-3' });
    g.items.forEach(item => grid.appendChild(renderMountArtifactCard(item, bucket, isMount)));
    container.appendChild(grid);
  });

  const bar = renderBulkActionBar(kind);
  if (bar) container.appendChild(bar);
}

function sumStatBlocks(...blocks) {
  const out = {};
  blocks.forEach(b => {
    Object.entries(b || {}).forEach(([k, v]) => {
      if (k === '_unparsed') return;
      out[k] = (out[k] || 0) + v;
    });
  });
  return out;
}

function resolveAwakenEffect(item, awakenLevel) {
  for (let lvl = awakenLevel; lvl >= 0; lvl--) {
    const text = lvl === 0 ? item.awaken_base_effect : (item.awaken_effects && item.awaken_effects[`A${lvl}`]);
    if (text && !text.startsWith('No additional effect')) {
      return { level: lvl, text, isCarried: lvl !== awakenLevel };
    }
  }
  return null;
}

function hasStarProgression(item) {
  const deltas = item.star_up && item.star_up.deltas;
  if (!deltas) return false;
  return Object.values(deltas).some(d => d && Object.keys(d).length > 0);
}

function hasAwakenProgression(item) {
  const deltas = item.awaken && item.awaken.deltas;
  if (!deltas) return false;
  return Object.values(deltas).some(d => d && Object.keys(d).length > 0);
}

function renderMountArtifactCard(item, bucket, isMount) {
  const kind = isMount ? 'mounts' : 'artifacts';
  const s = getMountOrArtifactState(bucket, item.idx);
  const card = el('div', { class: `item-card r-${item.tier}` + (selectMode[kind] && selectedItems[kind].has(item.idx) ? ' selected' : '') });
  if (selectMode[kind]) card.appendChild(renderSelectionOverlay(kind, item.idx));
  card.appendChild(el('div', { class: 'card-header-row' }, [
    el('div', { class: 'header-left' }, [
      renderThumb(isMount ? 'mounts' : 'artifacts', item),
      el('div', { class: 'item-name' }, item.n),
    ]),
  ]));
  card.appendChild(el('div', { class: 'item-rarity' }, item.tier || ''));

  // Uncommon/Rare/Epic mounts have a star stepper in-game that does
  // nothing — confirmed by every star delta being an empty object, unlike
  // Legendary+ mounts where starring up genuinely changes stats. Showing
  // the stepper there is misleading, so it's hidden for those tiers.
  // Same idea applies per-item now, not just per-tier — Sword of Victory
  // Oath (Legendary artifact) has neither star nor awaken progression at
  // all, confirmed the same way.
  const showStars = hasStarProgression(item);
  const showAwaken = hasAwakenProgression(item);

  const stepperRows = [];
  if (showStars) {
    stepperRows.push(el('div', { class: 'stepper-row' }, [
      el('span', { class: 'val', style: 'min-width:56px;text-align:left;color:var(--ink-dim);font-family:var(--font-body);font-size:11px;' }, 'Stars'),
      renderStepper(`${bucket}-${item.idx}-stars`, s.stars, 0, 5,
        (next) => { s.stars = next; saveState(); render(); }),
    ]));
  }
  if (showAwaken) {
    stepperRows.push(el('div', { class: 'stepper-row' }, [
      el('span', { class: 'val', style: 'min-width:56px;text-align:left;color:var(--ink-dim);font-family:var(--font-body);font-size:11px;' }, 'Awaken'),
      renderStepper(`${bucket}-${item.idx}-awaken`, s.awaken, 0, 10,
        (next) => { s.awaken = next; saveState(); render(); },
        (v) => `A${v}`),
    ]));
  }

  card.appendChild(el('div', { class: 'card-controls-row' }, [
    renderOwnedBadge(s.owned, (checked) => { s.owned = checked; saveState(); render(); }),
    el('div', { class: 'steppers-col' }, stepperRows),
  ]));

  if (!s.owned) return card;

  if (!item.star_up) {
    card.appendChild(el('div', { class: 'item-effect placeholder' },
      el('span', { class: 'coming-soon-badge' }, 'Coming Soon')));
    return card;
  }

  // Show live totals = base + star delta + awaken delta. Base stats live in
  // awaken.base_stats for both item types (mounts don't scale stats by star
  // at all, so star_up.base_stats is empty there — awaken.base_stats is the
  // one reliable source, and it's identical to star_up.base_stats for
  // artifacts anyway, so this works for both without branching.)
  const starDelta = showStars && s.stars > 0 ? item.star_up.deltas[String(s.stars)] : null;
  const awakenDelta = s.awaken > 0 ? item.awaken.deltas[`A${s.awaken}`] : null;
  const total = sumStatBlocks(item.awaken.base_stats, starDelta, awakenDelta);
  const labelParts = [];
  if (showStars) labelParts.push(`${s.stars}★`);
  if (showAwaken) labelParts.push(`A${s.awaken}`);
  card.appendChild(el('div', { class: 'item-effect', style: 'margin-top:8px;border-top:1px solid var(--hairline);padding-top:8px;' },
    [labelParts.length ? `At ${labelParts.join(' / ')}: ` : '', formatStatBlockNodes(total, true)]));

  const starEff = showStars && item.star_effects && item.star_effects[String(s.stars)];
  if (starEff) card.appendChild(el('div', { class: 'item-effect', style: 'font-style:italic;' }, [`★${s.stars}: `, renderTextWithSkillTags(starEff)]));

  const resolved = resolveAwakenEffect(item, s.awaken);
  if (resolved) {
    card.appendChild(el('div', { class: 'item-effect', style: 'font-style:italic;' },
      [`A${s.awaken}: `, renderTextWithSkillTags(resolved.text)]));
  }

  return card;
}

/* ---------- Pets ---------- */
function renderPets() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Pet roster. Battle Skill level reflects your pet\'s level tier (1★ at Lv1, up to 5★ at Lv80+). Only Mythic and above awaken — the Awaken control only appears where it applies.'));

  const groups = buildTierGroups(DB.pets);
  groups.forEach(g => {
    wrap.appendChild(el('div', { class: 'tier-group-title', id: `pets-${g.slug}` }, g.tier));
    const grid = el('div', { class: 'card-grid cols-3' });
    g.items.forEach(item => grid.appendChild(renderPetCard(item)));
    wrap.appendChild(grid);
  });

  return wrap;
}

const BATTLE_LV_KEYS = ['Lv1 (pet lv 1+)', 'Lv2 (pet lv 20+)', 'Lv3 (pet lv 40+)', 'Lv4 (pet lv 60+)', 'Lv5 (pet lv 80+)'];

function resolvePetAwakenEffect(item, awakenLevel) {
  for (let lvl = awakenLevel; lvl >= 0; lvl--) {
    const text = item.awaken_effects && item.awaken_effects[`A${lvl}`];
    if (text) return { level: lvl, text };
  }
  return null;
}

function renderPetCard(item) {
  const s = getPetState(item.idx);
  const hasAwaken = item.awaken_effects && Object.keys(item.awaken_effects).length > 0;

  const card = el('div', { class: `item-card r-${item.tier}` });
  card.appendChild(el('div', { class: 'card-header-row' }, [
    el('div', { class: 'header-left' }, [
      renderThumb('pets', item),
      el('div', { class: 'item-name' }, item.n),
    ]),
  ]));
  card.appendChild(el('div', { class: 'item-rarity' }, item.tier || ''));

  const battleStepper = el('div', { class: 'stepper-row' }, [
    el('span', { class: 'val', style: 'min-width:56px;text-align:left;color:var(--ink-dim);font-family:var(--font-body);font-size:11px;' }, 'Battle Lv'),
    renderStepper(`pet-${item.idx}-battlelv`, s.battleLv, 1, 5,
      (next) => { s.battleLv = next; saveState(); render(); }),
  ]);

  const steppersCol = [battleStepper];
  if (hasAwaken) {
    steppersCol.push(el('div', { class: 'stepper-row' }, [
      el('span', { class: 'val', style: 'min-width:56px;text-align:left;color:var(--ink-dim);font-family:var(--font-body);font-size:11px;' }, 'Awaken'),
      renderStepper(`pet-${item.idx}-awaken`, s.awaken, 0, 10,
        (next) => { s.awaken = next; saveState(); render(); },
        (v) => `A${v}`),
    ]));
  }

  card.appendChild(el('div', { class: 'card-controls-row' }, [
    renderOwnedBadge(s.owned, (checked) => { s.owned = checked; saveState(); render(); }),
    el('div', { class: 'steppers-col' }, steppersCol),
  ]));

  if (!s.owned) return card;

  const skillText = item.battle_skills && item.battle_skills[BATTLE_LV_KEYS[s.battleLv - 1]];
  if (skillText) {
    card.appendChild(el('div', { class: 'item-effect' }, [`Lv${s.battleLv}: `, renderTextWithSkillTags(skillText)]));
  } else {
    card.appendChild(el('div', { class: 'item-effect placeholder' }, 'No skill data at this level yet'));
  }

  if (hasAwaken) {
    const resolved = resolvePetAwakenEffect(item, s.awaken);
    if (resolved) {
      card.appendChild(el('div', { class: 'item-effect', style: 'font-style:italic;' },
        [`A${s.awaken}: `, renderTextWithSkillTags(resolved.text)]));
    }
  }

  return card;
}

/* ============================================================
   Calculator — PvP stat aggregation engine
   ============================================================
   Pulls a flat map of every numeric stat from everything already
   tracked in Collection (owned + starred). A fixed, curated list of named
   PvP-relevant stats (CALC_STAT_DEFS below) then pulls whichever raw keys
   feed into each one — some stats (Crit Rate, Combo Rate) are the sum of
   several differently-named keys across relics/mounts/artifacts/
   collectibles that all mean the same thing in-game. */

function sumBlockAtLevel(item, stars, awaken) {
  const starDelta = stars > 0 ? item.star_up.deltas[String(stars)] : null;
  const awakenDelta = awaken > 0 ? item.awaken.deltas[`A${awaken}`] : null;
  return sumStatBlocks(item.awaken.base_stats, starDelta, awakenDelta);
}

function aggregatePvpStats() {
  const totals = {}; // key -> value (flat, no categorization)
  const add = (key, val) => {
    if (typeof val !== 'number' || Number.isNaN(val)) return;
    totals[key] = (totals[key] || 0) + val;
  };

  // Every character starts with 200% Crit DMG before any bonuses — confirmed
  // base value, not something owned gear grants.
  add('crit_dmg', 200);

  // Relics — star_stats at current star level
  DB.relics.forEach(r => {
    if (!state.relicOwned[r.n]) return;
    const star = state.relicStars[r.n] || 0;
    Object.entries(r.star_stats || {}).forEach(([key, vals]) => add(key, vals[star] || 0));
  });

  // Collectibles — single stat at current star level. Values are already
  // in natural percent-scale straight from source (e.g. 12 = 12%, not a
  // 0.12 fraction needing ×100) — matches how relics store star_stats.
  DB.collectibles.forEach(c => {
    if (!state.collectibleOwned[c.n]) return;
    const star = Math.min(state.collectibleStars[c.n] || 0, 10);
    const val = c.star_vals[star];
    if (val != null) add(c.stat_key, val);
  });

  // Mounts & Artifacts — full base+star+awaken total at current levels
  [['mounts', 'mountState'], ['artifacts', 'artifactState']].forEach(([kind, bucketKey]) => {
    DB[kind].forEach(item => {
      if (item.n === 'None' || !item.star_up) return;
      const s = getMountOrArtifactState(bucketKey, item.idx);
      if (!s.owned) return;
      const block = sumBlockAtLevel(item, s.stars, s.awaken);
      Object.entries(block).forEach(([key, val]) => add(key, val));
    });
  });

  return totals;
}

// ---- Full-detail stat table (with per-source attribution) ----
// Walks every structured, numeric data source in the app — equipment
// psionics, gems with a real numeric value, pet skills, relics,
// collectibles, mounts/artifacts, adventurer stat buffs, fashion, and
// homestead — and records not just the total per stat but exactly which
// item contributed how much, keyed by the same display label used
// throughout the app (mostly the psionic stat names, since those already
// match this table's requested labels almost one-to-one).
//
// Deliberately NOT included: Hero and Brand quality/polarization bonuses.
// Those only exist as free-form prose ("Camera Smash reduces enemy final
// damage bonus by 15%") with no structured stat-key + numeric-value pair
// to aggregate — extracting one reliably would mean guessing at a parser
// for arbitrary game-design text, which risks being silently wrong rather
// than just incomplete. They're still visible on their own cards.
//
// Also NOT included: a round-by-round (R1–R5) breakdown. Some sources are
// genuinely conditional on turn count ("first 3 turns", "every 3 turns"),
// but that timing lives only in unstructured effect text, not as tagged
// data — building a fabricated 5-column split from that would look far
// more precise than it actually is.
const RELIC_KEY_TO_LABEL = {
  armor_break: 'Armor Break', armor_break_res: 'Armor Break Resistance',
  tenacity: 'Tenacity', tenacity_res: 'Tenacity Resistance',
  hp: 'HP', hp_pct: 'HP%', atk: 'ATK', atk_pct: 'ATK%',
  global_hp: 'Global HP', global_hp_pct: 'Global HP%', global_atk: 'Global ATK', global_attack_pct: 'Global ATK', global_def_pct: 'Global DEF%',
  combo: 'Combo Rate', counter: 'Counter Rate',
  combo_rate_pct: 'Combo Rate', counter_rate_pct: 'Counter Rate',
  crit_rate_pct: 'Crit Rate (Generic)', ignore_crit_pct: 'Ignore Crit',
  skill_crit_rate: 'Skill Crit Rate', basic_atk_crit_rate: 'Basic ATK Crit Rate', ignore_basic_atk_crit_rate: 'Ignore Normal ATK Crit', ignore_skill_crit: 'Ignore Skill Crit',
  ignore_combo: 'Ignore Combo', ignore_combo_pct: 'Ignore Combo', ignore_counter: 'Ignore Counter', ignore_counter_pct: 'Ignore Counter',
  dmg_reduction_pct: 'Generic DMG Reduction', skill_dmg: 'Skill DMG', skill_dmg_reduction: 'Skill DMG Reduction',
  basic_atk_dmg: 'Basic ATK DMG', basic_atk_dmg_reduction: 'Basic ATK DMG Reduction',
  final_skill_dmg: 'Final Skill Damage', final_skill_dmg_reduction: 'Skill Damage Final Damage Reduction',
  final_basic_atk_dmg: 'Final Normal ATK DMG', final_basic_atk_dmg_reduction: 'Basic Attack Final Damage Reduction',
  pet_dmg_pct: 'Pet DMG', speed: 'Speed', suppression: 'Ignore Suppression',
  control_immunity: 'Control Immunity Rate', ignore_control_immunity: 'Ignore Control Immunity Rate',
  dotcritrate: 'DoT Crit Rates', ignoredotcritrate: 'Ignore DoT Crit',
  // Collectibles use a different (but conceptually identical) key-naming
  // convention than relics/mounts/artifacts — without these, their
  // contributions were silently computed but never shown, since the
  // fallback (raw stat_label text, e.g. "Crit DMG %") never matches any
  // of the Calculator's exact category label strings. Only added where
  // the concept is an unambiguous match to an existing category — stats
  // with no real Calculator category (gold gain, AFK gains, lifesteal,
  // shield bonus, etc.) are deliberately left out rather than force-fit.
  crit_dmg: 'Crit DMG (Default to 200% as base)', crit_dmg_reduction: 'Crit DMG Reduction',
  combo_dmg: 'Combo DMG', combo_dmg_reduction: 'Combo DMG Reduction',
  counter_dmg: 'Counter DMG', counter_dmg_reduction: 'Counter DMG Reduction',
  lightning_dmg: 'Lightning DMG', lightning_dmg_reduction: 'Lightning DMG Reduction',
  fire_dmg: 'Fire DMG',
  dot_crit_rate: 'DoT Crit Rates',
  ignore_skill_crit_rate: 'Ignore Skill Crit', ignore_normal_attack_crit_rate: 'Ignore Normal ATK Crit',
};

// Gem names carry their number baked in (e.g. "Combo Damage Boost +45%"),
// so they never matched any Calculator category label directly — this was
// true even for the 47 gems with a tracked numeric value, not just the
// text-only ones. Strip the number to get a stable base phrase, then map
// that to the matching category label. Only unambiguous, general-purpose
// gems are mapped; character-specific synergy gems (e.g. "Clown damage
// +X", "Electro Dragon's paralysis chance +X") have no general PvP
// category to belong to and are deliberately left out.
function gemNameBase(name) {
  return name.replace(/\+?\d+(\.\d+)?%?/g, '+X').trim();
}
const GEM_NAME_TO_LABEL = {
  'Basic Attack Damage Boost +X': 'Basic ATK DMG', 'Basic Attack Damage Reduction +X': 'Basic ATK DMG Reduction',
  'Combo Damage Boost +X': 'Combo DMG', 'Combo Damage Reduction +X': 'Combo DMG Reduction',
  'Counterattack Damage Boost +X': 'Counter DMG', 'Counterattack Damage Reduction +X': 'Counter DMG Reduction',
  'Explosion Damage Boost +X': 'Explosion DMG',
  'Final Damage Boost +X': 'General Final Damage', 'Final Damage Reduction +X': 'General Final Damage Reduction',
  'Fire Damage Boost +X': 'Fire DMG', 'Fire Damage Reduction +X': 'Fire DMG Reduction',
  'Lightning Damage Boost +X': 'Lightning DMG', 'Lightning Damage Reduction +X': 'Lightning DMG Reduction',
  'Physical Damage Boost +X': 'Physical DMG',
  'Combo Rate +X': 'Combo Rate', 'Counter Rate +X': 'Counter Rate',
  'Dagger Crit Rate +X': 'Dagger Crit Rate', 'DoT Crit Rate +X': 'DoT Crit Rates',
  'Lightning Crit Rate +X': 'Lightning Crit Rate', 'Sword Qi Crit Rate +X': 'Sword Qi Crit Rate',
  'Weapon Crit Rate +X': 'Weapon Crit Rate',
  'Ignore Combo Rate +X': 'Ignore Combo', 'Ignore Counter Rate +X': 'Ignore Counter', 'Ignore Critical Rate +X': 'Ignore Crit',
  'Global Attack +X': 'Global ATK', 'Speed +X': 'Speed',
  'Combo Damage Coefficient +X': 'Combo DMG Coef', 'Counterattack Damage Coefficient +X': 'Counter DMG Coef',
  'Dagger Damage Coefficient +X': 'Dagger DMG Coef', 'Lightning Damage Coefficient +X': 'Lightning DMG Coef',
};

// Pulls the tier-scaling numeric value out of a gem, whether it has a
// tracked numeric array or only ever had descriptive text. For text-only
// gems: if the description has exactly one percentage, that's the value.
// If it has more than one (e.g. "+30% damage to targets with HP above
// 70%" — a scaling bonus alongside a static threshold), compare against
// the lowest tier's text to find which number actually changes between
// tiers — that's the real one, not just whichever appears first.
function extractGemScalingValue(meta, tier) {
  if (meta.t && meta.t[tier - 1] != null) return meta.t[tier - 1];
  const td = meta.tier_desc;
  if (!td || !td[tier]) return null;
  const currentPcts = [...td[tier].matchAll(/\d+(?:\.\d+)?%/g)].map(m => m[0]);
  if (currentPcts.length === 0) return null;
  if (currentPcts.length === 1) return parseFloat(currentPcts[0]);
  const basePcts = td[1] ? [...td[1].matchAll(/\d+(?:\.\d+)?%/g)].map(m => m[0]) : [];
  for (let i = 0; i < currentPcts.length; i++) {
    if (currentPcts[i] !== basePcts[i]) return parseFloat(currentPcts[i]);
  }
  return null; // couldn't isolate which number scales — don't guess
}

function aggregateFullStatsWithSources() {
  const stats = {}; // label -> { total, sources: [{name, val}] }
  const add = (label, val, sourceName) => {
    if (typeof val !== 'number' || Number.isNaN(val) || val === 0) return;
    if (!stats[label]) stats[label] = { total: 0, sources: [] };
    stats[label].total += val;
    stats[label].sources.push({ name: sourceName, val });
  };

  add('Crit DMG (Default to 200% as base)', 200, 'Base');
  add('Speed', 5, 'Base');

  // Relics
  DB.relics.forEach(r => {
    if (!state.relicOwned[r.n]) return;
    const star = state.relicStars[r.n] || 0;
    Object.entries(r.star_stats || {}).forEach(([key, vals]) => {
      const val = vals[star];
      const label = RELIC_KEY_TO_LABEL[key];
      if (label && val) add(label, val, `${r.n} (${star}★)`);
    });
  });

  // Collectibles
  DB.collectibles.forEach(c => {
    if (!state.collectibleOwned[c.n]) return;
    const star = Math.min(state.collectibleStars[c.n] || 0, 10);
    const val = c.star_vals[star];
    const label = RELIC_KEY_TO_LABEL[c.stat_key] || (c.is_percent ? c.stat_label : null);
    if (label && val) add(label, val, `${c.n} (${star}★)`);
  });

  // Mounts & Artifacts
  [['mounts', 'mountState'], ['artifacts', 'artifactState']].forEach(([kind, bucketKey]) => {
    DB[kind].forEach(item => {
      if (item.n === 'None' || !item.star_up) return;
      const s = getMountOrArtifactState(bucketKey, item.idx);
      if (!s.owned) return;
      const block = sumBlockAtLevel(item, s.stars, s.awaken);
      Object.entries(block).forEach(([key, val]) => {
        const label = RELIC_KEY_TO_LABEL[key];
        if (label && val) add(label, val, `${item.n} (${s.stars}★/A${s.awaken})`);
      });
    });
  });

  // Equipment Psionics — stat name already matches this table's labels directly
  EQUIPMENT_SLOTS.forEach(slotDef => {
    const s = state.equipment[slotDef.id];
    if (!s || !s.psionics) return;
    const psiOptions = DB.psionics[slotDef.psiKey] || [];
    s.psionics.forEach(slot => {
      if (!slot.stat || !slot.val) return;
      const meta = psiOptions.find(o => o.c === slot.stat);
      if (meta) add(meta.n, slot.val, `${slotDef.label} psionic`);
    });
  });

  // Equipment Gems — numeric value from meta.t where tracked, otherwise
  // extracted directly from the tier_desc text (covers the majority of
  // gems, which only ever had a text description, not a numeric array —
  // those were previously silently skipped entirely here). Label comes
  // from GEM_NAME_TO_LABEL, not the raw gem name, since gem names carry
  // their own baked-in number and never matched a category directly.
  EQUIPMENT_SLOTS.forEach(slotDef => {
    const s = state.equipment[slotDef.id];
    if (!s || !s.gems) return;
    const gemOptions = DB.gems[slotDef.gemKey] || [];
    s.gems.forEach(slot => {
      if (!slot.gemId) return;
      const meta = gemOptions.find(o => o.id === slot.gemId);
      if (!meta) return;
      const label = GEM_NAME_TO_LABEL[gemNameBase(meta.n)];
      if (!label) return;
      const val = extractGemScalingValue(meta, slot.tier);
      if (val != null) add(label, val, `${slotDef.label} gem`);
    });
  });

  // Pet Skills — stat name already matches this table's labels directly
  state.petSlots.forEach((p, pi) => {
    if (!p.itemName) return;
    p.skills.forEach(sl => {
      if (!sl.stat || !sl.val) return;
      add(sl.stat, sl.val, `Pet ${pi + 1}: ${p.itemName}`);
    });
  });

  // Adventurer stat buffs (ATK/HP only — the only structured numeric part)
  const adv = state.adventurerSlot;
  if (adv && adv.name) {
    const advData = (DB.adventurers || []).find(a => a.n === adv.name);
    if (advData) {
      const { statTotals } = computeAdventurerDisplay(advData.tier_effects, adv.stars);
      Object.entries(statTotals).forEach(([stat, val]) => add(`${stat}%`, val, `Adventurer: ${adv.name}`));
    }
  }

  // Fashion Level
  if (state.fashionLevel > 0) {
    const levels = DB.fashion_levels || [];
    let totalFd = 0, totalFdr = 0;
    const statTotals = {};
    for (let i = 1; i <= state.fashionLevel; i++) {
      const lv = levels[i];
      if (!lv) continue;
      totalFd += lv.fd || 0;
      totalFdr += lv.fdr || 0;
      Object.entries(parseFashionNoteStats(lv.note)).forEach(([stat, val]) => { statTotals[stat] = (statTotals[stat] || 0) + val; });
    }
    if (totalFd) add('General Final Damage', Math.round(totalFd * 10000) / 100, `Fashion Level ${state.fashionLevel}`);
    if (totalFdr) add('General Final Damage Reduction', Math.round(totalFdr * 10000) / 100, `Fashion Level ${state.fashionLevel}`);
    Object.entries(statTotals).forEach(([stat, val]) => add(`${stat}%`, val, `Fashion Level ${state.fashionLevel}`));
  }

  // Homestead
  (DB.homestead_buildings || []).forEach(b => {
    const lv = state.homestead[b.id];
    if (!lv) return;
    const val = b.values[lv - 1];
    if (val == null) return;
    const pct = Math.round(val * 10000) / 100;
    const label = RELIC_KEY_TO_LABEL[b.calc] || (b.label === 'Final DMG Boost' ? 'General Final Damage' : b.label === 'Final DMG Red' ? 'General Final Damage Reduction' : b.label);
    add(label, pct, `${b.name} (Lv.${lv})`);
  });

  return stats;
}

const CALC_TABLE_CATEGORIES = [
  { title: 'Final Damage Reduction', labels: ['General Final Damage Reduction', 'Skill Damage Final Damage Reduction', 'Basic Attack Final Damage Reduction', 'Conditional Final Damage Reduction', 'Adventurer Final Damage Reduction', 'Artifact Final Damage Reduction', 'Mount Final Damage Reduction', 'Pet Final Damage Reduction'] },
  { title: 'DMG Reduction', labels: ['Generic DMG Reduction', 'Skill DMG Reduction', 'Basic ATK DMG Reduction', 'Combo DMG Reduction', 'Counter DMG Reduction', 'Lightning DMG Reduction', 'Dagger DMG Reduction', 'Sword Qi DMG Reduction', 'Light Spear DMG Red', 'Fire DMG Reduction', 'DoT DMG Reduction', 'Crit DMG Reduction', 'Skill Crit DMG Red', 'Basic ATK Crit DMG Red', 'DoT Crit DMG Red'] },
  { title: 'Final Damage', labels: ['General Final Damage', 'Final Skill Damage', 'Final Lightning DMG', 'Final Sword Qi DMG', 'Final Dagger DMG', 'Final Combo DMG', 'Final Counter DMG', 'Final Normal ATK DMG'] },
  { title: 'Damage Coefficients', labels: ['General DMG Coef', 'Skill DMG Coef', 'Normal ATK DMG Coef', 'Combo DMG Coef', 'Counter DMG Coef', 'Lightning DMG Coef', 'Dagger DMG Coef', 'Sword Qi DMG Coef', 'Fire DMG Coef'] },
  { title: 'Tenacity & Armor Break', labels: ['Tenacity', 'Tenacity Resistance', 'Armor Break', 'Armor Break Resistance'] },
  { title: 'Ignore Proc Rates', labels: ['Ignore Combo', 'Ignore Crit', 'Ignore Weapon Crit', 'Ignore Skill Crit', 'Ignore Normal ATK Crit', 'Ignore Counter'] },
  { title: 'Proc Rates', labels: ['Combo Rate', 'Counter Rate'] },
  { title: 'Speed', labels: ['Speed'] },
  { title: 'Crit Rates', labels: ['Crit Rate (Generic)', 'Skill Crit Rate', 'Basic ATK Crit Rate', 'Weapon Crit Rate', 'Lightning Crit Rate', 'DoT Crit Rates', 'Dagger Crit Rate', 'Sword Qi Crit Rate', 'Light Spear Crit Rate'] },
  { title: 'Bonus Damage', labels: ['Global ATK', 'Crit DMG (Default to 200% as base)', 'Skill DMG', 'Basic ATK DMG', 'Combo DMG', 'Counter DMG', 'Lightning DMG', 'Dagger DMG', 'Sword Qi DMG', 'Light Spear DMG', 'DoT DMG', 'Fire DMG', 'Explosion DMG', 'Physical DMG'] },
];

// Simple collapsible accordion — pure DOM toggle, no state persistence
// needed since it's just a display convenience, not something worth
// remembering across renders. ghost=true drops the boxed-card look (no
// border/background) for cases that just need the collapse behavior
// without looking like a distinct container.
function renderAccordion(title, contentEl, defaultOpen, ghost) {
  const wrap = el('div', { class: 'accordion' + (defaultOpen ? ' open' : '') + (ghost ? ' ghost' : '') });
  const header = el('div', { class: 'accordion-header' }, [
    el('span', { class: 'accordion-title' }, title),
    el('span', { class: 'accordion-chevron' }, '\u25BE'),
  ]);
  const body = el('div', { class: 'accordion-body' }, contentEl);
  header.addEventListener('click', () => {
    wrap.classList.toggle('open');
  });
  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

const CALC_NON_PERCENT_LABELS = new Set(['Tenacity', 'Tenacity Resistance', 'Armor Break', 'Armor Break Resistance', 'Speed']);

function buildFullCalcTable() {
  const wrap = el('div', {});
  const stats = aggregateFullStatsWithSources();

  const controls = el('div', { class: 'calc-full-table-controls' });
  let allExpanded = false;
  let emptyHidden = false;
  const allEntries = []; // { statRow, sourceRows, chevron, hasSources, emptyRow }

  const expandAllBtn = el('button', { class: 'filter-chip' }, 'Expand All');
  const hideEmptyBtn = el('button', { class: 'filter-chip' }, 'Hide Empty');
  expandAllBtn.addEventListener('click', () => {
    allExpanded = !allExpanded;
    expandAllBtn.textContent = allExpanded ? 'Collapse All' : 'Expand All';
    allEntries.forEach(({ sourceRows, chevron, hasSources }) => {
      if (!hasSources) return;
      sourceRows.forEach(r => r.classList.toggle('collapsed', !allExpanded));
      chevron.classList.toggle('expanded', allExpanded);
    });
  });
  hideEmptyBtn.addEventListener('click', () => {
    emptyHidden = !emptyHidden;
    hideEmptyBtn.textContent = emptyHidden ? 'Show Empty' : 'Hide Empty';
    allEntries.forEach(({ statRow, hasSources, emptyRow }) => {
      if (hasSources) return;
      statRow.classList.toggle('calc-row-hidden', emptyHidden);
      if (emptyRow) emptyRow.classList.toggle('calc-row-hidden', emptyHidden);
    });
  });
  controls.appendChild(expandAllBtn);
  controls.appendChild(hideEmptyBtn);
  wrap.appendChild(controls);

  // Quick-jump nav — clicking scrolls straight to that category's title,
  // skipping the scroll-and-hunt through every section above it.
  const jumpNav = el('div', { class: 'calc-jump-nav' });
  CALC_TABLE_CATEGORIES.forEach((cat, i) => {
    const anchorId = `calc-cat-${i}`;
    jumpNav.appendChild(el('a', {
      href: `#${anchorId}`, class: 'calc-jump-link',
      onclick: (e) => {
        e.preventDefault();
        document.getElementById(anchorId).scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, cat.title));
  });
  wrap.appendChild(jumpNav);

  CALC_TABLE_CATEGORIES.forEach((cat, catIdx) => {
    wrap.appendChild(el('div', { class: 'equip-section-title calc-category-title', id: `calc-cat-${catIdx}` }, cat.title));
    const table = el('table', { class: 'calc-full-table' });
    const tbody = el('tbody', {});
    cat.labels.forEach(label => {
      const entry = stats[label];
      const total = entry ? Math.round(entry.total * 100) / 100 : 0;
      const suffix = CALC_NON_PERCENT_LABELS.has(label) ? '' : '%';
      const hasSources = entry && entry.sources.length > 0;

      const sourceRows = [];
      let emptyRow = null;
      if (hasSources) {
        entry.sources.forEach(s => {
          sourceRows.push(el('tr', { class: 'calc-full-table-source-row collapsed' }, [
            el('td', {}, s.name),
            el('td', { class: 'calc-full-table-total' }, `+${Math.round(s.val * 100) / 100}`),
          ]));
        });
      } else {
        emptyRow = el('tr', { class: 'calc-full-table-source-row collapsed' }, [
          el('td', {}, '\u2014'), el('td', {}, ''),
        ]);
        sourceRows.push(emptyRow);
      }

      const chevron = hasSources ? el('span', { class: 'calc-full-table-chevron' }, '\u25BE') : null;
      const statRow = el('tr', {
        class: 'calc-full-table-stat-row' + (hasSources ? ' clickable' : ''),
        onclick: hasSources ? () => {
          sourceRows.forEach(r => r.classList.toggle('collapsed'));
          chevron.classList.toggle('expanded');
        } : null,
      }, [
        el('td', {}, [chevron, label]),
        el('td', { class: 'calc-full-table-total' }, `${total}${suffix}`),
      ]);
      tbody.appendChild(statRow);
      sourceRows.forEach(r => tbody.appendChild(r));
      allEntries.push({ statRow, sourceRows, chevron, hasSources, emptyRow });
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  });

  return wrap;
}

// The fixed, curated list of PvP-relevant stats shown on the Calculator —
// each pulls and sums whichever raw keys represent that stat across every
// data source, since the same real-world stat often ended up with
// different key names in relics vs. mounts/artifacts vs. collectibles.
const CALC_STAT_DEFS = [
  { label: 'Tenacity', keys: ['tenacity'], notPct: true },
  { label: 'Ignore Tenacity', keys: ['tenacity_res'], notPct: true },
  { label: 'Armor Break', keys: ['armor_break'], notPct: true },
  { label: 'Ignore Armor Break', keys: ['armor_break_res'], notPct: true },
  { label: 'DMG Red', keys: ['basic_atk_dmg_reduction', 'skill_dmg_reduction', 'dmg_reduction_pct'] },
  { label: 'FDR', keys: ['final_basic_atk_dmg_reduction', 'final_skill_dmg_reduction'], highlight: true },
  { label: 'Additional Damage Boost', keys: ['basic_atk_dmg', 'skill_dmg', 'pet_dmg_pct'], caption: 'Affected by enemy tenacity' },
  { label: 'Final Damage Boost', keys: ['final_basic_atk_dmg', 'final_skill_dmg'], highlight: true },
  { label: 'Final Basic Damage Boost', keys: ['final_basic_atk_dmg'] },
  { label: 'Final Basic Attack Damage Reduction', keys: ['final_basic_atk_dmg_reduction'] },
  { label: 'Final Skill Damage Boost', keys: ['final_skill_dmg'] },
  { label: 'Final Skill Damage Reduction', keys: ['final_skill_dmg_reduction'] },
  { label: 'Crit Rate', keys: ['basic_atk_crit_rate', 'skill_crit_rate', 'dotcritrate', 'crit_rate_pct'] },
  { label: 'Ignore Crit Rate', keys: ['ignore_basic_atk_crit_rate', 'ignore_skill_crit', 'ignoredotcritrate', 'ignore_crit_pct'] },
  { label: 'Crit Damage', keys: ['crit_dmg', 'dagger_crit_dmg'] },
  { label: 'Ignore Crit Damage', keys: ['crit_dmg_reduction'] },
  { label: 'Combo Rate', keys: ['combo', 'combo_rate_pct'] },
  { label: 'Ignore Combo Rate', keys: ['ignore_combo', 'ignore_combo_pct'] },
  { label: 'Counter Rate', keys: ['counter', 'counter_rate_pct'] },
  { label: 'Ignore Counter Rate', keys: ['ignore_counter', 'ignore_counter_pct'] },
  { label: 'Block', keys: ['block'], notPct: true },
];

function pctEffectiveness(delta) {
  const A = 7000, cap = 0.85;
  return Math.min(Math.max(0, delta) / (A + Math.max(0, delta)), cap) * 100;
}

/* ---------- Calculator UI ---------- */
function renderCalculator() {
  const wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'section-title' }, 'Calculator'));
  wrap.appendChild(el('p', { class: 'section-desc' }, 'Values will auto populate as changes are made to the sheet'));

  const totals = aggregatePvpStats();

  wrap.appendChild(renderAccordion('Full Stat Breakdown', buildFullCalcTable(), true, true));

  // Final ATK / Final HP — base stat × (1 + %-bonuses), same pattern
  // Effective HP is built from. No absolute Final DEF is shown since
  // nothing tracked so far grants a flat DEF value — only Global DEF% —
  // so that's shown as its own % card instead of a fabricated total.
  const flatATK = totals.atk || 0;
  const atkPctBonus = (totals.atk_pct || 0) + (totals.global_atk || 0) + (totals.global_attack_pct || 0);
  const finalATK = flatATK * (1 + atkPctBonus / 100);

  const flatHP = totals.hp || 0;
  const hpPctBonus = (totals.hp_pct || 0) + (totals.global_hp || 0) + (totals.global_hp_pct || 0);
  const finalHP = flatHP * (1 + hpPctBonus / 100);

  const dmgRed = ['basic_atk_dmg_reduction', 'skill_dmg_reduction', 'dmg_reduction_pct'].reduce((a, k) => a + (totals[k] || 0), 0);
  const fdr = ['final_basic_atk_dmg_reduction', 'final_skill_dmg_reduction'].reduce((a, k) => a + (totals[k] || 0), 0);
  const ehp = finalHP > 0 ? finalHP / ((1 - Math.min(dmgRed, 99) / 100) * (1 - Math.min(fdr, 99) / 100)) : 0;

  const cards = [];
  cards.push(renderStatCard('Final ATK', formatBigNumber(finalATK)));
  cards.push(renderStatCard('Final HP', formatBigNumber(finalHP)));
  cards.push(renderStatCard('Global DEF%', `${(totals.global_def_pct || 0).toFixed(1)}%`));
  cards.push(renderStatCard('Effective HP', formatBigNumber(ehp), null, true));

  CALC_STAT_DEFS.forEach(def => {
    const sum = def.keys.reduce((a, k) => a + (totals[k] || 0), 0);
    const value = def.notPct ? sum.toLocaleString() : `${sum.toFixed(1)}%`;
    cards.push(renderStatCard(def.label, value, def.caption, def.highlight));
  });

  const tenacity = totals.tenacity || 0;
  const armorBreak = totals.armor_break || 0;
  cards.push(renderStatCard('Tenacity Eff', `${pctEffectiveness(tenacity).toFixed(1)}%`, null, false, pctEffectiveness(tenacity)));
  cards.push(renderStatCard('Armor Break Eff', `${pctEffectiveness(armorBreak).toFixed(1)}%`, null, false, pctEffectiveness(armorBreak)));

  wrap.appendChild(renderAccordion('Quick Stats', el('div', { class: 'calc-stat-grid' }, cards), true, true));

  return wrap;
}

function formatBigNumber(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

function renderStatCard(label, value, caption, highlight, effPct) {
  const children = [
    el('div', { class: 'calc-stat-card-label' }, label),
    el('div', { class: 'calc-stat-card-value' + (highlight ? ' highlight' : '') }, value),
  ];
  if (caption) children.push(el('div', { class: 'calc-stat-card-caption' }, caption));
  if (typeof effPct === 'number') {
    children.push(el('div', { class: 'calc-stat-card-bar' },
      el('div', { class: 'calc-stat-card-bar-fill', style: `width:${Math.min(effPct / 85 * 100, 100)}%` })));
  }
  return el('div', { class: 'calc-stat-card' }, children);
}


function syncTopbarHeight() {
  const topbar = document.querySelector('.topbar');
  if (topbar) document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
}
syncTopbarHeight();
window.addEventListener('resize', syncTopbarHeight);

const backToTopBtn = document.getElementById('back-to-top');
backToTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const delta = y - lastScrollY;

  const select = document.querySelector('.mobile-section-select');
  if (select) {
    if (y < 80 || delta < -4) {
      select.classList.remove('select-hidden');
    } else if (delta > 4) {
      select.classList.add('select-hidden');
    }
  }

  backToTopBtn.classList.toggle('visible', y > 400 && !selectMode.relics && !selectMode.collectibles);
  lastScrollY = y;
}, { passive: true });

/* ============================================================
   Light / dark theme toggle — persisted across sessions
   ============================================================ */
const THEME_KEY = 'capydex_theme_v1';
const themeToggleBtn = document.getElementById('theme-toggle');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀' : '☾';
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  applyTheme(saved === 'light' ? 'light' : 'dark');
})();

themeToggleBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
});

/* ============================================================
   Init
   ============================================================ */
render();
