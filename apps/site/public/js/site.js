/** The page's small behaviours: arriving on scroll, the copy button, the interest chips, the release line. */

const MAX_INTERESTS = 5;
const COPIED_FOR_MS = 1800;
const BYTES_PER_KB = 1024;

function revealOnScroll() {
  const blocks = [...document.querySelectorAll('.reveal')];
  // What is already on screen is shown before the hidden state is switched on, so nothing blinks.
  const onScreen = (block) => block.getBoundingClientRect().top < window.innerHeight * 0.92;
  for (const block of blocks.filter(onScreen)) {
    block.classList.add('is-inview');
  }
  document.documentElement.classList.add('js');

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-inview');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  for (const block of blocks) {
    observer.observe(block);
  }
}

function markScrolled() {
  const top = document.querySelector('[data-top]');
  if (!top) {
    return;
  }
  const update = () => top.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/** Selects the text, for a browser that will not let a page write to the clipboard. */
function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function copyButtons() {
  for (const button of document.querySelectorAll('[data-copy]')) {
    const source = button.parentElement?.querySelector('[data-copy-source]');
    if (!source) {
      continue;
    }
    const label = button.textContent;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.textContent ?? '');
        button.textContent = 'Copied';
      } catch {
        selectText(source);
        button.textContent = 'Press Ctrl/Cmd+C';
      }
      button.classList.add('is-done');
      window.setTimeout(() => {
        button.textContent = label;
        button.classList.remove('is-done');
      }, COPIED_FOR_MS);
    });
  }
}

/** The popup's rule, to play with: any five, and a sixth is not taken. */
function interestChips() {
  const group = document.querySelector('[data-interests]');
  const count = group?.querySelector('[data-interests-count]');
  if (!group || !count) {
    return;
  }
  const chips = [...group.querySelectorAll('.chip')];
  const picked = () => chips.filter((chip) => chip.getAttribute('aria-pressed') === 'true').length;
  const update = () => {
    const total = picked();
    const full = total >= MAX_INTERESTS;
    count.textContent = `${total} of ${MAX_INTERESTS} picked`;
    group.classList.toggle('is-full', full);
    // With five picked, the rest say they cannot be, rather than silently do nothing.
    for (const chip of chips) {
      chip.setAttribute('aria-disabled', String(full && chip.getAttribute('aria-pressed') !== 'true'));
    }
  };
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') === 'true';
      if (!on && picked() >= MAX_INTERESTS) {
        return;
      }
      chip.setAttribute('aria-pressed', String(!on));
      update();
    });
  }
  update();
}

/** Fills in the version and size of the download from the file the bundle step writes beside it. */
async function releaseLine() {
  try {
    const response = await fetch('/download/release.json');
    if (!response.ok) {
      return;
    }
    const release = await response.json();
    if (typeof release?.version === 'string' && /^[\w.-]{1,20}$/.test(release.version)) {
      for (const node of document.querySelectorAll('[data-release]')) {
        node.textContent = `Version ${release.version}`;
      }
    }
    if (Number.isFinite(release?.bytes) && release.bytes > 0) {
      for (const node of document.querySelectorAll('[data-release-size]')) {
        node.textContent = `${Math.round(release.bytes / BYTES_PER_KB)} KB.`;
      }
    }
  } catch {
    // No release file yet, or no network: the page keeps the text it was written with.
  }
}

revealOnScroll();
markScrolled();
copyButtons();
interestChips();
void releaseLine();
