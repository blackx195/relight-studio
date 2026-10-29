let dbPromise;
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('relight-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('project');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadProject() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('project').objectStore('project').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveProject(value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('project', 'readwrite');
    tx.objectStore('project').put(value, 'current');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('儲存已中斷'));
  });
}
