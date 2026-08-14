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
    petState: {},           // idx -> { owned, battleLv(1-5), awaken(0-10) }
    equipment: {},           // slotId -> { itemName, quality, surpass, arcana, psionics[4], gems[5] }
    petSlot: { itemName: '', arcana: -1, level: 0 },
    mountSlots: [{ itemIdx: null }, { itemIdx: null }, { itemIdx: null }], // 3 deployed — awaken skill each
    mountMainSlot: { itemIdx: null }, // 1 main — star skill
    artifactSlots: [{ itemIdx: null }, { itemIdx: null }, { itemIdx: null }],
    artifactMainSlot: { itemIdx: null },
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
  { id: 'relics', label: 'Relics', build: renderRelics, sub: () => buildTierGroups(DB.relics, 'rarity') },
  { id: 'collectibles', label: 'Collectibles', build: renderCollectibles, sub: () => buildTierGroups(DB.collectibles, 'rarity') },
  { id: 'mounts', label: 'Mounts', build: () => renderMountsOrArtifacts('mounts'), sub: () => buildTierGroups(DB.mounts.filter(x => x.n !== 'None')) },
  { id: 'artifacts', label: 'Artifacts', build: () => renderMountsOrArtifacts('artifacts'), sub: () => buildTierGroups(DB.artifacts.filter(x => x.n !== 'None')) },
  // Pets deliberately hidden from Collection for now (still fully built —
  // Equipment tab's Pet card already covers pet selection/arcana/skills).
  // Remind J this section still exists next time Collection scope comes up.
  // { id: 'pets', label: 'Pets', build: renderPets, sub: () => buildTierGroups(DB.pets) },
];

function renderPlaceholder(label) {
  return el('div', {}, [
    el('div', { class: 'section-title' }, label),
    el('p', { class: 'section-desc' }, `${label} is being built next.`),
  ]);
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
    'Weapon, Armor, 2 Rings, 2 Accessories. Quality defaults to the highest available (usually Mythic) when you pick an item — change it if yours is lower. Gem rarity defaults to Peerless the same way.'));
  const grid = el('div', { class: 'equip-grid' });
  EQUIPMENT_SLOTS.forEach(slotDef => grid.appendChild(renderEquipCard(slotDef)));
  wrap.appendChild(grid);
  return wrap;
}

function buildPetSectionContent() {
  const wrap = el('div', {});
  const petGrid = el('div', { class: 'equip-grid' });
  petGrid.appendChild(renderEquipPetCard());
  wrap.appendChild(petGrid);
  return wrap;
}

function buildMountsSectionContent() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Main mount (its Skill depends on Stars) plus 3 deployed mounts (each shows its Awaken-based skill).'));
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
    'Main artifact (its Skill depends on Stars) plus 3 deployed artifacts (each shows its Awaken-based skill).'));
  const mainGrid = el('div', { class: 'equip-grid equip-grid-single' });
  mainGrid.appendChild(renderDeployCard('artifact', 'star', null));
  wrap.appendChild(mainGrid);
  const grid = el('div', { class: 'equip-grid' });
  [0, 1, 2].forEach(i => grid.appendChild(renderDeployCard('artifact', 'awaken', i)));
  wrap.appendChild(grid);
  return wrap;
}

const EQUIPMENT_SECTIONS = [
  { id: 'equip-equipment', label: 'Equipment', build: buildEquipmentSectionContent },
  { id: 'equip-pet', label: 'Pet', build: buildPetSectionContent },
  { id: 'equip-mounts', label: 'Mounts', build: buildMountsSectionContent },
  { id: 'equip-artifacts', label: 'Artifacts', build: buildArtifactsSectionContent },
];

function renderEquipmentShell() {
  return renderSectionShell(EQUIPMENT_SECTIONS);
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
function renderEquipPetCard() {
  const s = state.petSlot;
  const pets = DB.pets || [];
  const pet = pets.find(p => p.n === s.itemName) || null;

  const card = el('div', { class: 'equip-card' });
  const headerImg = pet
    ? el('img', { src: itemImagePath('pets', pet), alt: pet.n, class: 'equip-card-thumb', onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-card-thumb placeholder' });
  card.appendChild(el('div', { class: 'equip-card-header' }, [headerImg, el('div', { class: 'equip-card-title' }, 'Pet')]));

  card.appendChild(equipFieldLabel('Pet'));
  const listId = 'pet-slot-search';
  const datalist = el('datalist', { id: listId }, pets.map(p => el('option', { value: p.n })));
  const input = el('input', {
    class: 'equip-combo-input', list: listId, placeholder: 'Search pets…',
    value: s.itemName || '',
  });
  input.addEventListener('input', (e) => {
    const match = pets.find(p => p.n === e.target.value);
    if (match) {
      s.itemName = match.n;
      s.arcana = -1;
      saveState();
      render();
    }
  });
  card.appendChild(datalist);
  card.appendChild(input);

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
    render();
  });
  card.appendChild(levelInput);

  if (s.level > 0) {
    const battleSkillKeys = Object.keys(pet.battle_skills || {});
    const thresholds = [1, 20, 40, 60, 80];
    let activeIdx = -1;
    for (let i = 0; i < thresholds.length; i++) if (s.level >= thresholds[i]) activeIdx = i;
    const activeKey = activeIdx >= 0 ? battleSkillKeys[activeIdx] : null;
    const activeText = activeKey ? pet.battle_skills[activeKey] : null;
    card.appendChild(equipFieldLabel(activeKey || 'Battle Skill'));
    card.appendChild(el('div', { class: 'equip-writeup' }, activeText || '—'));
  }

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
  const ownedItems = all.filter(it => {
    const st = state[bucketKey][it.idx];
    return st && st.owned;
  });
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
    card.appendChild(equipFieldLabel('Awaken'));
    card.appendChild(el('div', { class: 'equip-writeup' }, `A${itemState.awaken}`));
    if (item.star_up) {
      const resolved = resolveAwakenEffect(item, itemState.awaken);
      card.appendChild(equipFieldLabel('Awaken Skill'));
      card.appendChild(el('div', { class: 'equip-writeup' }, resolved ? resolved.text : '—'));
    }
  } else {
    card.appendChild(equipFieldLabel('Stars'));
    card.appendChild(el('div', { class: 'equip-writeup' }, `${itemState.stars}★`));
    if (item.star_effects) {
      const starEff = item.star_effects[String(itemState.stars)];
      card.appendChild(equipFieldLabel('Skill'));
      card.appendChild(el('div', { class: 'equip-writeup' }, starEff || '—'));
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
      card.appendChild(renderPsionicSlot(slotDef.id, i, slot, psiOptions));
    });
  }

  card.appendChild(el('hr', { class: 'equip-divider' }));

  // ---- Gems ----
  card.appendChild(el('div', { class: 'equip-section-title' }, 'Gems'));
  const gemOptions = DB.gems[slotDef.gemKey] || [];
  s.gems.forEach((slot, i) => {
    card.appendChild(equipFieldLabel(`Slot ${i + 1}`));
    card.appendChild(renderGemSlot(slotDef.id, i, slot, gemOptions));
  });

  return card;
}

function equipFieldLabel(text) {
  return el('div', { class: 'equip-field-label' }, text);
}

function psiOptionLabel(o) {
  return `${o.n} — ${o.k === 'n' ? 'Normal' : 'Special'}`;
}

function renderPsionicSlot(slotId, slotIdx, slotState, options) {
  const listId = `psi-opts-${slotId}-${slotIdx}`;
  const wrap = el('div', { class: 'equip-inline-row' });

  // Normal options first, then Special — datalist has no real <optgroup>
  // support across browsers, so the category is folded into the visible
  // label instead ("Stat Name — Normal" / "— Special").
  const sortedOptions = [...options].sort((a, b) => (a.k === b.k ? 0 : a.k === 'n' ? -1 : 1));
  const datalist = el('datalist', { id: listId },
    sortedOptions.map(o => el('option', { value: psiOptionLabel(o) })));

  const currentMeta = options.find(o => o.c === slotState.stat);
  const input = el('input', {
    class: 'equip-combo-input', list: listId, placeholder: 'Search stat…',
    value: currentMeta ? psiOptionLabel(currentMeta) : '',
  });
  input.addEventListener('input', (e) => {
    const match = options.find(o => psiOptionLabel(o) === e.target.value);
    if (match) {
      slotState.stat = match.c;
      saveState();
      render();
    }
  });

  const valInput = el('input', {
    type: 'number', class: 'equip-num-input', value: String(slotState.val || 0),
    oninput: (e) => { slotState.val = parseFloat(e.target.value) || 0; saveState(); },
    onblur: () => render(),
  });

  wrap.appendChild(datalist);
  wrap.appendChild(input);
  wrap.appendChild(el('div', { class: 'equip-pct-input-group' }, [valInput, el('span', {}, '%')]));

  const container = el('div', {}, [wrap]);
  if (slotState.stat) {
    const meta = options.find(o => o.c === slotState.stat);
    container.appendChild(el('div', { class: 'equip-writeup' }, `${meta ? meta.n : slotState.stat} +${slotState.val}%`));
  }
  return container;
}

function renderGemSlot(slotId, slotIdx, slotState, options) {
  const listId = `gem-opts-${slotId}-${slotIdx}`;
  const wrap = el('div', { class: 'equip-inline-row' });

  const datalist = el('datalist', { id: listId },
    options.map(o => el('option', { value: o.n })));

  const input = el('input', {
    class: 'equip-combo-input', list: listId, placeholder: 'Search gem…',
    value: slotState.gemId ? (options.find(o => o.id === slotState.gemId) || {}).n || '' : '',
  });
  input.addEventListener('input', (e) => {
    const match = options.find(o => o.n === e.target.value);
    if (match) {
      slotState.gemId = match.id;
      if (!slotState.tier) slotState.tier = 9; // default Peerless
      saveState();
      render();
    }
  });

  const tierSelect = el('select', { class: 'equip-select equip-tier-select', disabled: slotState.gemId ? null : 'true' },
    GEM_TIER_NAMES.map((name, i) => el('option', { value: String(i + 1), selected: (i + 1) === slotState.tier ? 'true' : null }, name)));
  tierSelect.addEventListener('change', (e) => { slotState.tier = parseInt(e.target.value, 10); saveState(); render(); });

  const tierIcon = slotState.gemId
    ? el('img', { class: 'equip-gem-tier-icon', src: `assets/images/gem_tiers/${slugify(GEM_TIER_NAMES[slotState.tier - 1])}.webp`, onerror: (e) => { e.target.style.visibility = 'hidden'; } })
    : el('div', { class: 'equip-gem-tier-icon placeholder' });

  wrap.appendChild(datalist);
  wrap.appendChild(input);
  wrap.appendChild(tierSelect);
  wrap.appendChild(tierIcon);

  const container = el('div', {}, [wrap]);
  if (slotState.gemId) {
    const meta = options.find(o => o.id === slotState.gemId);
    const val = meta && meta.t ? meta.t[slotState.tier - 1] : null;
    if (meta && val != null) {
      container.appendChild(el('div', { class: 'equip-writeup' }, `${meta.n} +${val}%`));
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
    section.appendChild(el('h2', { class: 'section-title' }, sec.label));
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

  const box = el('div', { class: 'modal-box' }, [
    el('div', { class: 'modal-title' }, `Set stars & awaken for ${ids.length} item${ids.length === 1 ? '' : 's'}`),
    el('div', { class: 'modal-input-label', style: 'text-align:center;margin-bottom:6px;' }, 'Stars'),
    el('div', { class: 'modal-star-picker' }, [
      el('button', { class: 'modal-star-btn', onclick: () => { starVal = Math.max(0, starVal - 1); starDisplay.textContent = `${starVal}★`; starInput.value = String(starVal); } }, '−'),
      starDisplay,
      el('button', { class: 'modal-star-btn', onclick: () => { starVal = Math.min(maxStar, starVal + 1); starDisplay.textContent = `${starVal}★`; starInput.value = String(starVal); } }, '+'),
    ]),
    el('div', { class: 'modal-input-row' }, [el('span', { class: 'modal-input-label' }, 'or type a number:'), starInput]),
    el('div', { class: 'modal-input-label', style: 'text-align:center;margin:14px 0 6px;' }, 'Awaken'),
    el('div', { class: 'modal-star-picker' }, [
      el('button', { class: 'modal-star-btn', onclick: () => { awakenVal = Math.max(0, awakenVal - 1); awakenDisplay.textContent = `A${awakenVal}`; awakenInput.value = String(awakenVal); } }, '−'),
      awakenDisplay,
      el('button', { class: 'modal-star-btn', onclick: () => { awakenVal = Math.min(maxAwaken, awakenVal + 1); awakenDisplay.textContent = `A${awakenVal}`; awakenInput.value = String(awakenVal); } }, '+'),
    ]),
    el('div', { class: 'modal-input-row' }, [el('span', { class: 'modal-input-label' }, 'or type a number:'), awakenInput]),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'bulk-action-btn secondary', onclick: closeModal }, 'Cancel'),
      el('button', {
        class: 'bulk-action-btn primary',
        onclick: () => {
          ids.forEach(id => cfg.apply(id, true, starVal, awakenVal));
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

function renderRelics() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Treasure Collection relics, 0★–10★. Filter by tier, multi-select relics within a tier, then mark them owned or assign stars to the whole selection at once. Set bonuses key off the lowest star level among owned set members.'));

  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: 'Search relics…',
    oninput: (e) => { relicSearch = e.target.value.toLowerCase(); renderRelicGroups(groupsWrap); },
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
    if (relicSearch && !r.n.toLowerCase().includes(relicSearch)) return false;
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
  card.appendChild(el('div', { class: 'item-rarity' }, relic.rarity + (relic.type ? ' · ' + relic.type : '')));

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
    if (relic.effect) {
      card.appendChild(el('div', { class: 'item-effect' },
        el('span', {}, ['10★: ', renderTextWithSkillTags(relic.effect)])));
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

function renderCollectibles() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Common Collection items, 0★–10★ per item. Set bonuses key off the lowest star level among all four members, same mechanic as relic sets.'));

  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: 'Search collectibles…',
    oninput: (e) => { collectibleSearch = e.target.value.toLowerCase(); renderCollectibleGroups(groupsWrap); },
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
    if (collectibleSearch && !c.n.toLowerCase().includes(collectibleSearch)) return false;
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
    const pct = Math.round(val * 10000) / 100; // trim float noise, keep up to 2 decimals
    card.appendChild(el('div', { class: 'item-effect' }, [
      item.stat_label + ': ',
      el('span', { class: 'stat-value-live' }, `${pct}%`),
    ]));
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
const TIER_ORDER = ['Common', 'Great', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Immortal', 'Transcendent'];

const mountArtifactFilters = {
  mounts: { search: '', tier: 'All', owned: 'All' },
  artifacts: { search: '', tier: 'All', owned: 'All' },
};

function renderMountsOrArtifacts(kind) {
  const isMount = kind === 'mounts';
  const bucket = isMount ? 'mountState' : 'artifactState';
  const filters = mountArtifactFilters[kind];

  const wrap = el('div', { class: isMount ? 'scope-mounts' : '' });
  wrap.appendChild(el('p', { class: 'section-desc' },
    isMount
      ? 'Transformation pool. Stat deltas from Star and Awaken levels add on top of base stats, same as artifacts — the card shows your totals live as you adjust the steppers.'
      : 'Equipped artifact pool. Stat deltas from Star and Awaken levels add on top of base stats — the card shows your totals live as you adjust the steppers.'));

  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: `Search ${kind}…`,
    oninput: (e) => { filters.search = e.target.value.toLowerCase(); renderMountArtifactGroups(kind, groupsWrap); },
  });
  toolbar.appendChild(search);

  const allItems = (isMount ? DB.mounts : DB.artifacts).filter(x => x.n !== 'None');
  const tierOptions = ['All', ...buildTierGroups(allItems).map(g => g.tier)];
  tierOptions.forEach(t => {
    const chip = el('button', {
      class: 'filter-chip' + (filters.tier === t ? ' active' : ''),
      onclick: () => {
        filters.tier = t;
        toolbar.querySelectorAll('.filter-chip[data-tier]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderMountArtifactGroups(kind, groupsWrap);
      },
    }, t);
    chip.dataset.tier = 'true';
    toolbar.appendChild(chip);
  });

  ['All', 'Owned', 'Not Owned'].forEach(o => {
    const chip = el('button', {
      class: 'filter-chip' + (filters.owned === o ? ' active' : ''),
      onclick: () => {
        filters.owned = o;
        toolbar.querySelectorAll('.filter-chip[data-owned]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderMountArtifactGroups(kind, groupsWrap);
      },
    }, o);
    chip.dataset.owned = 'true';
    toolbar.appendChild(chip);
  });

  toolbar.appendChild(el('button', {
    class: 'filter-chip' + (selectMode[kind] ? ' active' : ''),
    onclick: () => toggleSelectMode(kind),
  }, selectMode[kind] ? 'Cancel selecting' : 'Select multiple…'));
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
    if (filters.search && !it.n.toLowerCase().includes(filters.search)) return false;
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

  const starsStepper = el('div', { class: 'stepper-row' }, [
    el('span', { class: 'val', style: 'min-width:56px;text-align:left;color:var(--ink-dim);font-family:var(--font-body);font-size:11px;' }, 'Stars'),
    renderStepper(`${bucket}-${item.idx}-stars`, s.stars, 0, 5,
      (next) => { s.stars = next; saveState(); render(); }),
  ]);
  const awakenStepper = el('div', { class: 'stepper-row' }, [
    el('span', { class: 'val', style: 'min-width:56px;text-align:left;color:var(--ink-dim);font-family:var(--font-body);font-size:11px;' }, 'Awaken'),
    renderStepper(`${bucket}-${item.idx}-awaken`, s.awaken, 0, 10,
      (next) => { s.awaken = next; saveState(); render(); },
      (v) => `A${v}`),
  ]);

  card.appendChild(el('div', { class: 'card-controls-row' }, [
    renderOwnedBadge(s.owned, (checked) => { s.owned = checked; saveState(); render(); }),
    el('div', { class: 'steppers-col' }, [starsStepper, awakenStepper]),
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
  const starDelta = s.stars > 0 ? item.star_up.deltas[String(s.stars)] : null;
  const awakenDelta = s.awaken > 0 ? item.awaken.deltas[`A${s.awaken}`] : null;
  const total = sumStatBlocks(item.awaken.base_stats, starDelta, awakenDelta);
  card.appendChild(el('div', { class: 'item-effect', style: 'margin-top:8px;border-top:1px solid var(--hairline);padding-top:8px;' },
    [`At ${s.stars}★ / A${s.awaken}: `, formatStatBlockNodes(total, true)]));

  const starEff = item.star_effects && item.star_effects[String(s.stars)];
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

  // Relics — star_stats at current star level
  DB.relics.forEach(r => {
    if (!state.relicOwned[r.n]) return;
    const star = state.relicStars[r.n] || 0;
    Object.entries(r.star_stats || {}).forEach(([key, vals]) => add(key, vals[star] || 0));
  });

  // Collectibles — single stat at current star level
  DB.collectibles.forEach(c => {
    if (!state.collectibleOwned[c.n]) return;
    const star = Math.min(state.collectibleStars[c.n] || 0, 10);
    add(c.stat_key, (c.star_vals[star] || 0) * 100); // stored as fraction, display as %
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
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Auto-pulls PvP-relevant stats from everything owned and starred in Collection. Equipment and Inheritance will feed in here too once those tabs are built.'));

  const totals = aggregatePvpStats();

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
  cards.push(renderStatCard('Effective HP', formatBigNumber(ehp), 'With DMG Red and FDR', true));

  CALC_STAT_DEFS.forEach(def => {
    const sum = def.keys.reduce((a, k) => a + (totals[k] || 0), 0);
    const value = def.notPct ? sum.toLocaleString() : `${sum.toFixed(1)}%`;
    cards.push(renderStatCard(def.label, value, def.caption, def.highlight));
  });

  const tenacity = totals.tenacity || 0;
  const armorBreak = totals.armor_break || 0;
  cards.push(renderStatCard('Tenacity Eff', `${pctEffectiveness(tenacity).toFixed(1)}%`, null, false, pctEffectiveness(tenacity)));
  cards.push(renderStatCard('Armor Break Eff', `${pctEffectiveness(armorBreak).toFixed(1)}%`, null, false, pctEffectiveness(armorBreak)));

  wrap.appendChild(el('div', { class: 'calc-stat-grid' }, cards));

  wrap.appendChild(el('p', { class: 'section-desc', style: 'margin-top:16px;font-size:11px;' },
    'Effective HP = Final HP \u00f7 [(1 \u2212 DMG Red%) \u00d7 (1 \u2212 FDR%)] \u2014 the two reduction layers apply sequentially, not added together. Tenacity/Armor Break Eff show how much of the 85% diminishing-returns cap your current investment reaches on its own, without an opponent to compare against.'));

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
