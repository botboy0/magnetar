/* ============================================================
   project-card.js
   Renders a single card for either source:
     - 'yours'    → rename | duplicate | delete actions, file count
                    + relative-updated meta line
     - 'example'  → duplicate only, one-line description, no meta

   Tag colors cycle through (cy, vi, ma, or) based on index so
   any tag string gets a deterministic chip color without needing
   to encode it in storage.
   ============================================================ */

const TAG_CYCLE = ['cy', 'vi', 'ma', 'or'];
const TITLE_MAX_LEN = 60;

const ICON = {
  rename:    `<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>`,
  duplicate: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>`,
  delete:    `<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>`,
};

/* Render and return a card element.
   kind: 'yours' | 'example'
   data:
     yours    → project blob from project-storage
     example  → { slug, title, description, tags, author, thumb }
   handlers: { onOpen, onRename, onDuplicate, onDelete } — only
            the verbs that apply to the kind are read. */
export function renderCard(kind, data, handlers = {}) {
  const card = document.createElement('article');
  card.className = 'card';
  if (kind === 'yours')   card.dataset.projectId = data.id;
  if (kind === 'example') card.dataset.exampleSlug = data.slug;

  card.appendChild(renderThumb(kind, data));
  card.appendChild(renderActions(kind, handlers, card, data));
  card.appendChild(renderBed(kind, data));

  card.addEventListener('click', () => handlers.onOpen?.(data));
  return card;
}

function renderThumb(kind, data) {
  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  /* Candidate URL chain.
     - Examples: priority list (png → svg → webp → jpeg) from
       example-list.js's THUMB_EXTS — first that loads wins.
     - Yours: a single data: URL written by the editor after Run
       (project.thumb). Wraps to one-element array so we share
       the same onerror-walking logic.
     If everything fails the img element removes itself and the
     procedural gradient underneath shows through. */
  let candidates = [];
  if (Array.isArray(data.thumbs)) candidates = data.thumbs.slice();
  else if (data.thumb)            candidates = [data.thumb];

  if (candidates.length) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.classList.add('thumb-art');
    img.onerror = () => {
      const next = candidates.shift();
      if (next) img.src = next;
      else img.remove();
    };
    img.src = candidates.shift();
    thumb.appendChild(img);
  }
  return thumb;
}

function renderActions(kind, handlers, card, data) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const stop = (fn) => (e) => { e.stopPropagation(); fn?.(); };

  if (kind === 'yours') {
    actions.appendChild(iconButton('Rename',    ICON.rename,    stop(() => beginInlineRename(card, data, handlers.onRename))));
    actions.appendChild(iconButton('Duplicate', ICON.duplicate, stop(() => handlers.onDuplicate?.(data))));
    actions.appendChild(iconButton('Delete',    ICON.delete,    stop(() => handlers.onDelete?.(data)), true));
  } else {
    actions.appendChild(iconButton('Duplicate to your projects', ICON.duplicate, stop(() => handlers.onDuplicate?.(data))));
  }

  return actions;
}

function iconButton(title, path, onClick, danger = false) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn' + (danger ? ' danger' : '');
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg>`;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderBed(kind, data) {
  const bed = document.createElement('div');
  bed.className = 'card-bed';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = data.title || 'untitled';
  bed.appendChild(title);

  if (kind === 'example' && data.description) {
    const desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = data.description;
    bed.appendChild(desc);
  }

  bed.appendChild(renderTags(data.tags));

  if (kind === 'yours') {
    bed.appendChild(renderMeta(data));
  }

  return bed;
}

function renderTags(tags) {
  const wrap = document.createElement('div');
  wrap.className = 'tags';
  if (!Array.isArray(tags)) return wrap;
  tags.forEach((t, i) => {
    if (!t) return;
    const chip = document.createElement('span');
    chip.className = `tag ${TAG_CYCLE[i % TAG_CYCLE.length]}`;
    chip.textContent = String(t).toLowerCase();
    wrap.appendChild(chip);
  });
  return wrap;
}

function renderMeta(project) {
  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const fileCount = project.files ? Object.keys(project.files).length : 0;
  const fileSpan = document.createElement('span');
  fileSpan.textContent = `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
  meta.appendChild(fileSpan);

  if (project.updatedAt) {
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.textContent = '·';
    meta.appendChild(dot);

    const ago = document.createElement('span');
    ago.textContent = `updated ${formatRelative(project.updatedAt)}`;
    meta.appendChild(ago);
  }

  return meta;
}

/* Inline rename — swap title span for input, Enter commits,
   Esc reverts, blur commits. Same mechanics as the editor's
   project-rename.js, scoped to a single card. */
function beginInlineRename(card, project, onCommit) {
  const titleEl = card.querySelector('.card-title');
  if (!titleEl) return;
  const current = project.title || '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'card-title-input';
  input.value = current;
  input.maxLength = TITLE_MAX_LEN;
  input.setAttribute('aria-label', 'Project title');

  titleEl.replaceWith(input);
  input.focus();
  input.select();
  /* Stop clicks on the input from bubbling to the card open handler. */
  input.addEventListener('click', (e) => e.stopPropagation());

  let settled = false;
  const restoreSpan = (text) => {
    const span = document.createElement('div');
    span.className = 'card-title';
    span.textContent = text || 'untitled';
    input.replaceWith(span);
  };

  const commit = () => {
    if (settled) return;
    settled = true;
    let next = input.value.trim().slice(0, TITLE_MAX_LEN);
    if (!next) next = current;
    restoreSpan(next);
    if (next !== current) onCommit?.(project, next);
  };
  const revert = () => {
    if (settled) return;
    settled = true;
    restoreSpan(current);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); }
  });
  input.addEventListener('blur', commit);
}

/* Relative-time formatter for the Yours card meta line.
   Matches the mockup's vocabulary ("2h ago", "yesterday",
   "4d ago", "last week"). */
function formatRelative(ts) {
  const diffMs = Date.now() - ts;
  const min  = Math.floor(diffMs / 60000);
  const hour = Math.floor(min / 60);
  const day  = Math.floor(hour / 24);

  if (min  < 1)  return 'just now';
  if (min  < 60) return `${min}m ago`;
  if (hour < 24) return `${hour}h ago`;
  if (day  === 1) return 'yesterday';
  if (day  < 7)  return `${day}d ago`;
  if (day  < 14) return 'last week';
  if (day  < 30) return `${Math.floor(day / 7)}w ago`;
  if (day  < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
