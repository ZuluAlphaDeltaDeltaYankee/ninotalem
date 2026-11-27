// Reassemble large Unity files from static, GitHub Pages-compatible chunks.
//
// Memory notes: the data file is ~264 MB. Each chunk is copied straight into
// ONE preallocated buffer, which is handed to Unity's loader (config.preloadedData,
// see the patch in Build/WebGL.loader.js). There's no Blob and no object URL, and
// Unity doesn't download the data a second time, so only one copy exists.
async function prepareUnityChunks(config, onProgress) {
  const response = await fetch('Build/chunks.json', {cache: 'no-cache'});
  if (!response.ok) throw new Error('Unable to load game manifest (' + response.status + ').');
  const manifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid game manifest.');
  const total = manifest.files.reduce((sum, file) => sum + file.size, 0);
  let loaded = 0;

  for (const file of manifest.files) {
    const isData = new URL(config.dataUrl, document.baseURI).href === new URL(file.url, document.baseURI).href;
    if (!isData) throw new Error('Unknown game data entry in manifest.');

    const target = new Uint8Array(file.size);
    const offsets = [];
    let offset = 0;
    for (const part of file.parts) { offsets.push(offset); offset += part.size; }
    if (offset !== file.size) throw new Error('Incorrect game data size.');

    let next = 0;
    async function worker() {
      while (next < file.parts.length) {
        const index = next++;
        const part = file.parts[index];
        const result = await fetch(new URL(part.url, document.baseURI));
        if (!result.ok) throw new Error('Unable to download game data (' + result.status + ').');
        // Stream the chunk into the target buffer so no temporary 18 MB copy is made.
        const reader = result.body.getReader();
        let pos = offsets[index];
        const end = pos + part.size;
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          if (pos + value.byteLength > end) throw new Error('Incomplete game data. Please reload.');
          target.set(value, pos);
          pos += value.byteLength;
          loaded += value.byteLength;
          onProgress(total ? loaded / total : 1);
        }
        if (pos !== end) throw new Error('Incomplete game data. Please reload.');
      }
    }
    await Promise.all(Array.from({length: Math.min(2, file.parts.length)}, worker));
    config.preloadedData = target;
  }
  onProgress(1);
  return () => { delete config.preloadedData; };
}
