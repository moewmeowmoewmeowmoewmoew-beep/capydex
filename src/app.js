/* ============================================================
   State
   ============================================================ */
const STORAGE_KEY = 'capygo_player_state_v1';

function defaultState() {
  return {
    collectibleOwned: {},   // itemName -> bool
    collectibleStars: {},   // itemName -> number of stars, 0-10
    relicOwned: {},         // relicId -> bool
    relicStars: {},         // relicId -> 0-10
    mountState: {},         // idx -> { owned, stars(0-5), awaken(0-10) }
    artifactState: {},      // idx -> { owned, stars(0-5), awaken(0-10) }
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

function buildTierGroups(items) {
  const grouped = {};
  items.forEach(item => {
    const tier = item.tier || '(Untiered)';
    (grouped[tier] = grouped[tier] || []).push(item);
  });
  const ordered = [...TIER_ORDER.filter(t => grouped[t]), ...Object.keys(grouped).filter(t => !TIER_ORDER.includes(t))];
  return ordered.map(tier => ({ tier, slug: tierSlug(tier), items: grouped[tier] }));
}

const COLLECTION_SECTIONS = [
  { id: 'relics', label: 'Relics', build: renderRelics },
  { id: 'collectibles', label: 'Collectibles', build: renderCollectibles },
  { id: 'mounts', label: 'Mounts', build: () => renderMountsOrArtifacts('mounts'), sub: () => buildTierGroups(DB.mounts.filter(x => x.n !== 'None')) },
  { id: 'artifacts', label: 'Artifacts', build: () => renderMountsOrArtifacts('artifacts'), sub: () => buildTierGroups(DB.artifacts.filter(x => x.n !== 'None')) },
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

function renderRelics() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Treasure Collection relics, 0★–10★. Set bonuses key off the lowest star level among owned set members, not the total — see the note on each set panel.'));

  // Set panels first (context before the grid)
  const setsWrap = el('div', {});
  const allSets = Object.values(DB.relic_sets).flat();
  allSets.forEach(set => setsWrap.appendChild(renderRelicSetPanel(set)));
  wrap.appendChild(setsWrap);

  // Toolbar
  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: 'Search relics…',
    oninput: (e) => { relicSearch = e.target.value.toLowerCase(); renderRelicGrid(grid); },
  });
  toolbar.appendChild(search);
  ['All', 'Rare', 'Epic', 'Legendary', 'Mythic'].forEach(r => {
    const chip = el('button', {
      class: 'filter-chip' + (relicRarityFilter === r ? ' active' : ''),
      onclick: () => {
        relicRarityFilter = r;
        toolbar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderRelicGrid(grid);
      },
    }, r);
    toolbar.appendChild(chip);
  });
  wrap.appendChild(toolbar);

  const grid = el('div', { class: 'card-grid' });
  wrap.appendChild(grid);
  renderRelicGrid(grid);

  return wrap;
}

function renderRelicGrid(grid) {
  grid.innerHTML = '';
  const items = DB.relics.filter(r => {
    if (relicRarityFilter !== 'All' && r.rarity !== relicRarityFilter) return false;
    if (relicSearch && !r.n.toLowerCase().includes(relicSearch)) return false;
    return true;
  });
  items.forEach(r => grid.appendChild(renderRelicCard(r)));
}

function renderRelicCard(relic) {
  const owned = !!state.relicOwned[relic.id];
  const star = state.relicStars[relic.id] || 0;

  const card = el('div', { class: `item-card r-${relic.rarity}` });
  card.appendChild(el('div', { class: 'card-header-row' }, [
    el('div', { class: 'header-left' }, [
      renderThumb('relics', relic),
      el('div', { class: 'item-name' }, relic.n),
    ]),
  ]));
  card.appendChild(el('div', { class: 'item-rarity' }, relic.rarity + (relic.type ? ' · ' + relic.type : '')));

  const stepper = renderStepper(
    `relic-${relic.id}`, star, 0, 10,
    (next) => setRelicStar(relic.id, next),
    (v) => `${v}★`
  );
  card.appendChild(el('div', { class: 'card-controls-row' }, [
    renderOwnedBadge(owned, (checked) => {
      state.relicOwned[relic.id] = checked;
      if (!checked) state.relicStars[relic.id] = 0;
      saveState();
      render();
    }),
    el('div', { class: 'steppers-col' }, [stepper]),
  ]));

  if (owned) {
    card.appendChild(el('div', { class: 'item-effect' + (relic.effect ? '' : ' placeholder') },
      relic.effect ? el('span', {}, ['10★: ', renderTextWithSkillTags(relic.effect)]) : 'Effect not yet documented'));

    if (relic.star_stats) {
      const nodes = formatStatBlockNodes(
        Object.fromEntries(Object.entries(relic.star_stats).map(([stat, vals]) => [stat, vals[star]]))
      );
      card.appendChild(el('div', { class: 'item-effect' }, nodes));
    }
  }

  return card;
}

function setRelicStar(relicId, next) {
  state.relicStars[relicId] = next;
  if (next > 0) state.relicOwned[relicId] = true;
  saveState();
  render();
}

const RELIC_TIER_STARS = [0, 2, 4, 6, 8, 10];
const RELIC_TIER_LABELS = ['Set', '2★', '4★', '6★', '8★', '10★'];

function renderRelicSetPanel(set) {
  // Match set members to relic IDs by name for owned/star lookup
  const memberRelics = set.items.map(name => DB.relics.find(r => r.n === name)).filter(Boolean);
  const allOwned = memberRelics.length > 0 && memberRelics.every(r => state.relicOwned[r.id]);
  const minStar = allOwned ? Math.min(...memberRelics.map(r => state.relicStars[r.id] || 0)) : -1;

  let tierIdx = -1;
  if (allOwned) {
    tierIdx = 0;
    for (let i = RELIC_TIER_STARS.length - 1; i >= 0; i--) {
      if (minStar >= RELIC_TIER_STARS[i]) { tierIdx = i; break; }
    }
  }

  const panel = el('div', { class: 'set-panel' });
  panel.appendChild(el('div', { class: 'set-header' }, [
    el('div', { class: 'set-name' }, set.set),
    el('div', { class: 'set-stat' }, set.stat),
  ]));

  const track = el('div', { class: 'set-tier-track' });
  set.vals.forEach((v, i) => {
    const reached = allOwned && i <= tierIdx;
    const active = allOwned && i === tierIdx;
    track.appendChild(el('div', {
      class: 'tier-pip' + (reached ? ' reached' : '') + (active ? ' active' : ''),
    }, `${RELIC_TIER_LABELS[i]}: ${v}${typeof v === 'number' && v < 20 ? '%' : ''}`));
  });
  panel.appendChild(track);

  const members = el('div', { class: 'set-members' });
  set.items.forEach(name => {
    const r = DB.relics.find(x => x.n === name);
    const owned = r && state.relicOwned[r.id];
    members.appendChild(el('span', { class: 'set-member' + (owned ? ' owned' : '') }, name));
  });
  panel.appendChild(members);

  panel.appendChild(el('div', { class: 'set-current-bonus' },
    allOwned
      ? ['Current: ', el('b', {}, `${set.vals[tierIdx]}${typeof set.vals[tierIdx] === 'number' && set.vals[tierIdx] < 20 ? '%' : ''} ${set.stat}`), ` (min star ${minStar})`]
      : 'Not active — own every set member to unlock.'
  ));

  panel.appendChild(el('div', { class: 'set-note' },
    'Assumes tiers replace rather than stack (unconfirmed in-game — see project notes).'));

  return panel;
}

/* ---------- Collectibles ---------- */
let collectibleSearch = '';

function renderCollectibles() {
  const wrap = el('div', {});
  wrap.appendChild(el('p', { class: 'section-desc' },
    'Common Collection items, 0★–10★ per item. Set bonuses key off the lowest star level among all four members, same mechanic as relic sets.'));

  const setsWrap = el('div', {});
  const allSets = Object.values(DB.collectible_sets).flat();
  allSets.forEach(set => setsWrap.appendChild(renderCollectibleSetPanel(set)));
  wrap.appendChild(setsWrap);

  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', {
    class: 'search-input', type: 'text', placeholder: 'Search collectibles…',
    oninput: (e) => { collectibleSearch = e.target.value.toLowerCase(); renderCollectibleGrid(grid); },
  });
  toolbar.appendChild(search);
  wrap.appendChild(toolbar);

  const grid = el('div', { class: 'card-grid' });
  wrap.appendChild(grid);
  renderCollectibleGrid(grid);

  return wrap;
}

function renderCollectibleGrid(grid) {
  grid.innerHTML = '';
  const items = DB.collectibles.filter(c => !collectibleSearch || c.n.toLowerCase().includes(collectibleSearch));
  items.forEach(c => grid.appendChild(renderCollectibleCard(c)));
}

function renderCollectibleCard(item) {
  const owned = !!state.collectibleOwned[item.n];
  const maxStar = item.star_vals.length - 1;
  const stars = Math.min(state.collectibleStars[item.n] || 0, maxStar);
  const card = el('div', { class: `item-card r-${item.rarity}` });
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
  // Bonus scales with the lowest star level among owned set members (same
  // mechanic as relics, confirmed via meowdb). Requires every member owned.
  const allOwned = set.items.every(name => state.collectibleOwned[name]);
  const minStar = allOwned ? Math.min(...set.items.map(name => state.collectibleStars[name] || 0)) : -1;
  let tierIdx = 0;
  if (allOwned) {
    for (let i = COLLECTIBLE_TIER_STARS.length - 1; i >= 0; i--) {
      if (minStar >= COLLECTIBLE_TIER_STARS[i]) { tierIdx = i; break; }
    }
  }

  const panel = el('div', { class: 'set-panel' });
  panel.appendChild(el('div', { class: 'set-header' }, [
    el('div', { class: 'set-name' }, set.set),
    el('div', { class: 'set-stat' }, set.stat),
  ]));

  const track = el('div', { class: 'set-tier-track' });
  set.vals.forEach((v, i) => {
    const reached = allOwned && i <= tierIdx;
    const active = allOwned && i === tierIdx;
    track.appendChild(el('div', {
      class: 'tier-pip' + (reached ? ' reached' : '') + (active ? ' active' : ''),
    }, `${COLLECTIBLE_TIER_LABELS[i]}: ${v}%`));
  });
  panel.appendChild(track);

  const members = el('div', { class: 'set-members' });
  set.items.forEach(name => {
    const owned = !!state.collectibleOwned[name];
    members.appendChild(el('span', { class: 'set-member' + (owned ? ' owned' : '') }, name));
  });
  panel.appendChild(members);

  panel.appendChild(el('div', { class: 'set-current-bonus' },
    allOwned
      ? ['Current: ', el('b', {}, `${set.vals[tierIdx]}% ${set.stat}`), ` (min star ${minStar} across set)`]
      : 'Not active — own every set member to unlock.'
  ));

  return panel;
}

/* ---------- Mounts & Artifacts ---------- */
const TIER_ORDER = ['Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Immortal', 'Transcendent'];

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

  backToTopBtn.classList.toggle('visible', y > 400);
  lastScrollY = y;
}, { passive: true });

/* ============================================================
   Init
   ============================================================ */
render();
