import { creationId } from './core.js';

// Checkpoint every paid task ID before waiting: an interrupted tab resumes the
// existing task instead of submitting another credit-consuming generation.
export async function processItem(item, recipe, client, checkpoint, progress) {
  item.recipe ||= structuredClone(recipe);
  const project = item.recipe.folderReference ? { folderReference: item.recipe.folderReference } : {};
  if (!item.sourceId) {
    progress('上傳原圖');
    item.sourceId = await client.upload(item.original, item.recipe.folderReference);
    await checkpoint();
  }
  if (!item.relightId) {
    progress('建立打光工作');
    item.uncertain = 'relight';
    await checkpoint();
    const result = await client.call('images_relight', { creationIdentifier: item.sourceId, ...item.recipe, numImages: 1 });
    item.relightId = creationId(result);
    item.uncertain = null;
    await checkpoint();
  }
  progress('AI 打光中');
  await client.waitFor(item.relightId);
  if (!item.cutoutId) {
    progress('建立去背工作');
    item.uncertain = 'cutout';
    await checkpoint();
    const result = await client.call('images_remove_background', { creationIdentifier: item.relightId, ...project });
    item.cutoutId = creationId(result);
    item.uncertain = null;
    await checkpoint();
  }
  progress('自動去背中');
  const outputUrl = await client.waitFor(item.cutoutId);
  progress('下載透明圖片');
  const blob = await client.download(outputUrl);
  item.output = blob;
  await checkpoint();
  return blob;
}

export async function runPool(items, concurrency, run, shouldStop = () => false) {
  let next = 0;
  const results = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await run(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }));
  return results;
}
