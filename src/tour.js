import './tour.css';

const SEEN_KEY = 'relight-quick-tour-v1';
const steps = [
  {
    target: '.assets-panel', title: '先放進這次要做的圖',
    text: '點「加入圖片」一次選多張。想先試試？到畫布按「先用示範素材試試」就好。',
  },
  {
    target: '.scene-wrap', title: '把光調到你喜歡',
    text: '拖曳這個預覽轉光向，下方可以調亮度和顏色。整批都會套用同一組燈光。',
    note: '這裡是即時模擬，實際效果要等 AI 產圖。',
  },
  {
    target: '[aria-label="產圖設定"]', title: '一次幫整批打光',
    text: '先在右上角連接 Magnific，再選解析度、專案和同時處理數。選 MAX 就送出整批，按「批量打光並去背」開始。',
    note: '會使用 Magnific credits，官網 Unlimited 不適用。',
  },
  {
    target: '.comparison-toolbar', title: '看看前後差多少',
    text: '用「原圖／打光後」切換比較。哪張不滿意，滑鼠移上去按 ↻，就用那張上次的燈光重產。',
  },
  {
    target: '[aria-label="排列方式"]', title: '把整組排好',
    text: '上方能換底圖，畫布會跟著底圖比例走。這裡調列數、欄數和間距；按住數字上下拖就能改，也能用「隨機排列」換順序。',
  },
  {
    target: '.bottom-bar > div:last-child', title: '滿意了，就帶走',
    text: '整張排版用 PNG，個別去背圖用 ZIP。想下次接著做，記得按「儲存專案」。',
    note: '想重看這段？點右上角「快速教學」就找得到。',
  },
];

export function createQuickTour(trigger, openHelp) {
  const dialog = document.createElement('dialog');
  dialog.className = 'quick-tour';
  dialog.setAttribute('aria-labelledby', 'tour-title');
  dialog.setAttribute('aria-describedby', 'tour-text');
  dialog.innerHTML = `
    <div class="tour-spotlight" aria-hidden="true"></div>
    <div class="tour-card">
      <div class="tour-content" aria-live="polite" aria-atomic="true">
        <span class="tour-counter"></span>
        <h2 id="tour-title"></h2>
        <p id="tour-text"></p>
        <p class="tour-note"></p>
      </div>
      <div class="tour-progress" aria-hidden="true">${steps.map(() => '<span></span>').join('')}</div>
      <div class="tour-actions">
        <button class="text-btn tour-skip">先跳過</button>
        <button class="secondary tour-prev">上一步</button>
        <button class="primary tour-next" autofocus>下一步 →</button>
      </div>
      <button class="text-btn tour-help">查看完整說明 ↗</button>
    </div>`;
  document.body.append(dialog);
  const get = selector => dialog.querySelector(selector);
  const card = get('.tour-card'), spotlight = get('.tour-spotlight');
  const next = get('.tour-next'), prev = get('.tour-prev');
  let index = 0, target, frame, scrollPositions = [];

  function position() {
    if (!dialog.open || !target) return;
    const w = document.documentElement.clientWidth, h = window.innerHeight;
    const r = target.getBoundingClientRect();
    // Clip the highlight to scrollable panels as well as the viewport.
    let left = Math.max(8, r.left - 5), top = Math.max(8, r.top - 5);
    let right = Math.min(w - 8, r.right + 5), bottom = Math.min(h - 8, r.bottom + 5);
    for (let el = target.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el), bounds = el.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
    }
    Object.assign(spotlight.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
    const clamp = (value, max) => Math.max(12, Math.min(value, max));
    const centeredX = clamp((left + right - cw) / 2, w - cw - 12);
    const centeredY = clamp((top + bottom - ch) / 2, h - ch - 12);
    const candidates = [
      { x: right + gap, y: centeredY },
      { x: left - gap - cw, y: centeredY },
      { x: centeredX, y: bottom + gap },
      { x: centeredX, y: top - gap - ch },
    ];
    const fitting = candidates.find(p => p.x >= 12 && p.y >= 12 && p.x + cw <= w - 12 && p.y + ch <= h - 12);
    const p = fitting || { x: centeredX, y: h - ch - 12 };
    Object.assign(card.style, { left: `${p.x}px`, top: `${Math.max(12, p.y)}px` });
  }

  function schedulePosition() { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); }
  function render() {
    const step = steps[index];
    target = document.querySelector(step.target);
    get('.tour-counter').textContent = `快速教學 · ${index + 1} / ${steps.length}`;
    get('#tour-title').textContent = step.title;
    get('#tour-text').textContent = step.text;
    get('.tour-note').textContent = step.note || '';
    get('.tour-note').hidden = !step.note;
    get('.tour-help').hidden = index !== steps.length - 1;
    get('.tour-skip').hidden = index === steps.length - 1;
    prev.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? '開始使用 ✓' : '下一步 →';
    get('.tour-progress').childNodes.forEach((dot, i) => dot.classList.toggle('current', i === index));
    const narrow = window.innerWidth <= 640;
    target?.scrollIntoView({ behavior: 'instant', block: narrow ? 'start' : 'center', inline: 'nearest' });
    if (narrow) window.scrollBy({ top: -24, behavior: 'instant' });
    position();
    next.focus({ preventScroll: true });
  }

  function close() { dialog.close(); }
  function start() {
    if (dialog.open) return;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* Storage may be unavailable in private browsing. */ }
    scrollPositions = [document.scrollingElement, ...document.querySelectorAll('.panel')].map(el => [el, el.scrollLeft, el.scrollTop]);
    index = 0;
    dialog.showModal();
    render();
    window.addEventListener('resize', schedulePosition);
    document.addEventListener('scroll', schedulePosition, true);
  }
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedulePosition);
    document.removeEventListener('scroll', schedulePosition, true);
    for (const [el, x, y] of scrollPositions) el.scrollTo({ left: x, top: y, behavior: 'instant' });
    trigger.focus({ preventScroll: true });
  });
  next.addEventListener('click', () => { if (index === steps.length - 1) close(); else { index++; render(); } });
  prev.addEventListener('click', () => { if (index > 0) { index--; render(); } });
  get('.tour-skip').addEventListener('click', close);
  get('.tour-help').addEventListener('click', () => { close(); openHelp(); });
  // Esc is handled by the native modal; no tutorial step invokes app actions.
  return { start, maybeStart() { try { if (!localStorage.getItem(SEEN_KEY)) start(); } catch { /* Keep manual help available. */ } } };
}
