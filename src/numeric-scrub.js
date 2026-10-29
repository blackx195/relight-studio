// Vertical mouse dragging complements normal text entry and keyboard controls.
export function bindNumericScrub(input, pixelsPerStep = 2) {
  let gesture = null, suppressClick = false;
  input.classList.add('scrub-input');
  input.title = '按住左鍵上下拖曳調整；也可直接輸入';
  const emit = type => input.dispatchEvent(new Event(type, { bubbles: true }));
  const finish = (cancel = false) => {
    if (!gesture) return;
    const last = gesture; gesture = null;
    document.body.classList.remove('scrubbing-number');
    if (last.dragging) {
      if (cancel) { input.value = last.value; emit('input'); }
      emit('change'); suppressClick = true;
    }
    if (input.hasPointerCapture(last.pointerId)) input.releasePointerCapture(last.pointerId);
  };
  input.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || input.disabled || !Number.isFinite(input.valueAsNumber)) return;
    suppressClick = false;
    gesture = { y: event.clientY, value: input.valueAsNumber, pointerId: event.pointerId, dragging: false };
    input.setPointerCapture(event.pointerId);
  });
  input.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const delta = gesture.y - event.clientY;
    if (!gesture.dragging && Math.abs(delta) < 5) return;
    gesture.dragging = true; event.preventDefault();
    document.body.classList.add('scrubbing-number');
    const step = Number(input.step) || 1;
    const value = Math.min(Number(input.max), Math.max(Number(input.min), gesture.value + Math.trunc(delta / pixelsPerStep) * step));
    if (value !== input.valueAsNumber) { input.value = String(value); emit('input'); }
  });
  input.addEventListener('pointerup', () => finish());
  input.addEventListener('pointercancel', () => finish(true));
  input.addEventListener('lostpointercapture', () => finish());
  input.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(true); } });
  input.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); suppressClick = false; } });
  window.addEventListener('blur', () => finish());
}
