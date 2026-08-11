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

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeMainTab = btn.dataset.tab;
    render();
  });
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
  { id: 'pets', label: 'Pets', build: renderPets, sub: () => buildTierGroups(DB.pets) },
];

function renderPlaceholder(label) {
  return el('div', {}, [
    el('div', { class: 'section-title' }, label),
    el('p', { class: 'section-desc' }, `${label} is being built next.`),
  ]);
}

let scrollObserver;

function render() {
  root.innerHTML = '';
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }

  if (activeMainTab === 'collection') {
    root.appendChild(renderCollectionShell());
  } else {
    const labels = { equipment: 'Equipment', inheritance: 'Inheritance Tree', calculator: 'Calculator' };
    root.appendChild(renderPlaceholder(labels[activeMainTab] || activeMainTab));
  }

  focusActiveStepperInput();
}

function renderCollectionShell() {
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

  COLLECTION_SECTIONS.forEach(sec => {
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
  COLLECTION_SECTIONS.forEach(sec => {
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
    getOwned: (name) => !!state.relicOwned[name],
    getStar: (name) => state.relicStars[name] || 0,
    maxStar: () => 10,
    apply: (name, owned, star) => { state.relicOwned[name] = owned; state.relicStars[name] = star; },
  },
  collectibles: {
    getOwned: (name) => !!state.collectibleOwned[name],
    getStar: (name) => state.collectibleStars[name] || 0,
    maxStar: (item) => item.star_vals.length - 1,
    apply: (name, owned, star) => { state.collectibleOwned[name] = owned; state.collectibleStars[name] = star; },
  },
};

const selectMode = { relics: false, collectibles: false };
const selectedItems = { relics: new Set(), collectibles: new Set() };

function renderTierGroupHeader(kind, tierLabel, groupId, groupItems) {
  const cfg = BULK_CONFIG[kind];
  const allOwned = groupItems.length > 0 && groupItems.every(it => cfg.getOwned(it.n));
  const allSelected = groupItems.length > 0 && groupItems.every(it => selectedItems[kind].has(it.n));

  const header = el('div', { class: 'tier-group-header' });
  header.appendChild(el('div', { class: 'tier-group-title', id: groupId, style: 'margin:0;border:none;padding:0;' }, tierLabel));

  const btnRow = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
  if (selectMode[kind]) {
    btnRow.appendChild(el('button', {
      class: 'bulk-action-btn',
      onclick: () => {
        groupItems.forEach(it => allSelected ? selectedItems[kind].delete(it.n) : selectedItems[kind].add(it.n));
        render();
      },
    }, allSelected ? 'Deselect Tier' : 'Select Tier'));
  }
  btnRow.appendChild(el('button', {
    class: 'bulk-action-btn',
    onclick: () => {
      groupItems.forEach(it => cfg.apply(it.n, !allOwned, allOwned ? 0 : cfg.getStar(it.n)));
      saveState();
      render();
    },
  }, allOwned ? 'Unown All' : 'Own All'));
  header.appendChild(btnRow);

  return header;
}

function toggleSelectMode(kind) {
  selectMode[kind] = !selectMode[kind];
  if (!selectMode[kind]) selectedItems[kind].clear();
  render();
}

function toggleItemSelected(kind, name) {
  const set = selectedItems[kind];
  if (set.has(name)) set.delete(name); else set.add(name);
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
          [...selectedItems[kind]].forEach(n => cfg.apply(n, true, cfg.getStar(n)));
          saveState();
          render();
        },
      }, 'Mark Owned'),
      el('button', {
        class: 'bulk-action-btn',
        disabled: count === 0 ? 'true' : null,
        onclick: () => { if (count > 0) openStarAssignModal(kind); },
      }, 'Set Stars…'),
      el('button', { class: 'bulk-action-btn secondary', onclick: () => toggleSelectMode(kind) }, 'Done'),
    ]),
  ]);
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
    'Treasure Collection relics, 0★–10★. Set bonuses key off the lowest star level among owned set members.'));

  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: 'Search relics…',
    oninput: (e) => { relicSearch = e.target.value.toLowerCase(); renderRelicGroups(groupsWrap); },
  });
  toolbar.appendChild(search);
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
  const items = DB.relics.filter(r => !relicSearch || r.n.toLowerCase().includes(relicSearch));
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
  const items = DB.collectibles.filter(c => !collectibleSearch || c.n.toLowerCase().includes(collectibleSearch));
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
  const maxStar = item.star_vals.length - 1;
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

function renderMountsOrArtifacts(kind) {
  const isMount = kind === 'mounts';
  const bucket = isMount ? 'mountState' : 'artifactState';
  const items = (isMount ? DB.mounts : DB.artifacts).filter(x => x.n !== 'None');

  const wrap = el('div', { class: isMount ? 'scope-mounts' : '' });
  wrap.appendChild(el('p', { class: 'section-desc' },
    isMount
      ? 'Transformation pool. Stat deltas from Star and Awaken levels add on top of base stats, same as artifacts — the card shows your totals live as you adjust the steppers.'
      : 'Equipped artifact pool. Stat deltas from Star and Awaken levels add on top of base stats — the card shows your totals live as you adjust the steppers.'));

  const groups = buildTierGroups(items);
  groups.forEach(g => {
    wrap.appendChild(el('div', { class: 'tier-group-title', id: `${kind}-${g.slug}` }, g.tier));
    const grid = el('div', { class: 'card-grid cols-3' });
    g.items.forEach(item => grid.appendChild(renderMountArtifactCard(item, bucket, isMount)));
    wrap.appendChild(grid);
  });

  return wrap;
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
  const s = getMountOrArtifactState(bucket, item.idx);
  const card = el('div', { class: `item-card r-${item.tier}` });
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
   Back-to-top FAB + measure topbar height for sticky offsets +
   hide-on-scroll-down / reveal-on-scroll-up for the mobile dropdown
   ============================================================ */
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
   Init
   ============================================================ */
render();
