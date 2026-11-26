import { hiddenToday, hideAllToday, validatePopupManifest } from './site-popups-core.mjs';

const dialog = document.getElementById('maxgainSitePopupDialog');
const status = document.getElementById('maxgainSitePopupStatus');
const fallbackFocus = document.querySelector('a.brand');
const storage = () => { try { return window.localStorage; } catch { return null; } };
const say = (ko, en) => document.documentElement.lang === 'en' ? en : ko;
let queue = [];
let position = 0;
let stopQueue = false;
let returnFocus = null;
let focusCaptured = false;

function restoreFocus() {
  const target = returnFocus?.isConnected && returnFocus !== document.body &&
    returnFocus !== document.documentElement && !dialog.contains(returnFocus)
    ? returnFocus : fallbackFocus;
  target?.focus({ preventScroll: true });
  if (target && document.activeElement !== target) fallbackFocus?.focus({ preventScroll: true });
}

function renderCurrent() {
  if (stopQueue || position >= queue.length) return;
  const item = queue[position];
  dialog.replaceChildren();

  const content = document.createElement('div');
  content.className = 'site-popup-content';
  const heading = document.createElement('h2');
  heading.id = 'maxgainSitePopupTitle';
  heading.textContent = item.title;
  const count = document.createElement('p');
  count.className = 'site-popup-count';
  count.textContent = `${position + 1} / ${queue.length}`;
  const image = document.createElement('img');
  image.src = new URL(item.imageUrl, document.baseURI).href;
  image.alt = item.alt;
  image.decoding = 'async';
  image.addEventListener('error', () => { if (dialog.open) dialog.close(); }, { once: true });
  content.append(count, heading, image);
  if (item.linkUrl) {
    const link = document.createElement('a');
    link.href = item.linkUrl;
    link.textContent = say('자세히 보기', 'Learn more');
    content.append(link);
  }

  const closeIcon = document.createElement('button');
  closeIcon.type = 'button';
  closeIcon.className = 'site-popup-close-icon';
  closeIcon.textContent = '×';
  closeIcon.setAttribute('aria-label', say('팝업 닫기', 'Close popup'));
  closeIcon.addEventListener('click', () => dialog.close());

  const actions = document.createElement('div');
  actions.className = 'site-popup-actions';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = say('닫기', 'Close');
  dismiss.addEventListener('click', () => dialog.close());
  const hideAll = document.createElement('button');
  hideAll.type = 'button';
  hideAll.textContent = say('오늘 더 이상 안 보기', "Don't show any popups today");
  hideAll.addEventListener('click', () => {
    stopQueue = true;
    const saved = hideAllToday(storage());
    status.textContent = saved
      ? say('오늘의 모든 팝업을 숨겼습니다.', 'All popups are hidden for today.')
      : say('이 방문에서 모든 팝업을 숨겼습니다.', 'All popups are hidden for this visit.');
    dialog.close();
  });
  actions.append(dismiss, hideAll);
  dialog.append(closeIcon, content, actions);
  dialog.setAttribute('aria-labelledby', heading.id);
  if (!focusCaptured) {
    returnFocus = document.activeElement;
    focusCaptured = true;
  }
  dialog.showModal();
  dismiss.focus();
}

dialog?.addEventListener('close', () => {
  if (!stopQueue) {
    position += 1;
    if (position < queue.length) {
      renderCurrent();
      return;
    }
  }
  restoreFocus();
});

async function start() {
  if (!dialog || hiddenToday(storage())) return;
  try {
    const response = await fetch('data/site-popups.v1.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    queue = validatePopupManifest(manifest);
    renderCurrent();
  } catch {
    // Missing or invalid notices never interrupt the homepage.
  }
}

start();
