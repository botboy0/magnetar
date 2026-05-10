/* ============================================================
   Top strip — Navigator dropdown behavior.
   Ported from editor_v2_mockup.html with two adaptations:
   - ES module export (was IIFE)
   - Dropdown items populated from pathname (was hardcoded)
   ============================================================ */

const ICONS = {
  devlog:   `<path d="M15 3v18"/><path d="M8 7h4"/><path d="M8 11h4"/><rect x="3" y="3" width="18" height="18" rx="2"/>`,
  projects: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
  editor:   `<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>`,
};

const PAGES = {
  devlog:   { href: 'devlog.html',   label: 'Devlog',   icon: ICONS.devlog   },
  projects: { href: 'projects.html', label: 'Projects', icon: ICONS.projects },
  editor:   { href: 'editor.html',   label: 'Editor',   icon: ICONS.editor   },
};

function otherPages() {
  const path = window.location.pathname;
  if (path.endsWith('editor.html'))   return ['devlog', 'projects'];
  if (path.endsWith('devlog.html'))   return ['projects', 'editor'];
  if (path.endsWith('projects.html')) return ['devlog', 'editor'];
  // Default (root /, index.html redirect target): treat as Projects.
  return ['devlog', 'editor'];
}

function renderDropdownItems(innerEl) {
  const keys = otherPages();
  innerEl.innerHTML = keys.map(key => {
    const p = PAGES[key];
    return `
      <a class="nav-dropdown-item" href="${p.href}" role="menuitem">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          ${p.icon}
        </svg>
        <span>${p.label}</span>
      </a>
    `;
  }).join('');
}

export function init() {
  const { animate, createTimeline, stagger, utils } = window.anime;

  const navigators = document.querySelectorAll('.topstrip .navigator');

  navigators.forEach(nav => {
    const trigger = nav.querySelector('.navigator-trigger');
    const dropdown = nav.querySelector('.nav-dropdown');
    const inner = nav.querySelector('.nav-dropdown-inner');
    const chev = nav.querySelector('.chev');
    if (!trigger || !dropdown || !inner || !chev) return;

    // Populate the dropdown contextually before any animation measurements.
    renderDropdownItems(inner);
    const items = nav.querySelectorAll('.nav-dropdown-item');

    let isOpen = false;
    let activeTimeline = null;

    function open() {
      if (isOpen) return;
      isOpen = true;
      nav.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');

      const targetHeight = inner.offsetHeight;

      if (activeTimeline) activeTimeline.pause();

      activeTimeline = createTimeline({ defaults: { ease: 'outQuart' } })
        .add(dropdown, {
          maxHeight: [0, targetHeight],
          duration: 360,
          ease: 'outExpo',
        }, 0)
        .add(chev, {
          rotate: [0, 180],
          duration: 380,
          ease: 'outBack(1.4)',
        }, 20)
        .add(nav, {
          '--nav-border-opacity': [
            { to: 1, duration: 140, ease: 'outQuad' },
            { to: 0.85, duration: 220, ease: 'outQuart' },
          ],
          duration: 360,
        }, 40)
        .add(items, {
          opacity: [0, 1],
          scale: [0.96, 1],
          translateY: [-4, 0],
          duration: 320,
          ease: 'outCubic',
          delay: stagger(60),
        }, 80);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      trigger.setAttribute('aria-expanded', 'false');

      if (activeTimeline) activeTimeline.pause();

      activeTimeline = createTimeline({
        defaults: { ease: 'outQuad' },
        onComplete: () => {
          nav.classList.remove('open');
          utils.set(items, { opacity: 0, scale: 0.96, translateY: -4 });
        },
      })
        .add(items, { opacity: 0, duration: 120 }, 0)
        .add(dropdown, { maxHeight: 0, duration: 220, ease: 'inQuad' }, 0)
        .add(chev, { rotate: 0, duration: 240 }, 0)
        .add(nav, { '--nav-border-opacity': 0.45, duration: 200 }, 0);
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen ? close() : open();
    });
  });

  // click-outside dismiss
  document.addEventListener('click', (e) => {
    navigators.forEach(nav => {
      if (!nav.contains(e.target) && nav.classList.contains('open')) {
        nav.querySelector('.navigator-trigger').click();
      }
    });
  });

  // escape dismiss
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    navigators.forEach(nav => {
      if (nav.classList.contains('open')) {
        nav.querySelector('.navigator-trigger').click();
      }
    });
  });
}