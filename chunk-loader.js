// Reassemble large Unity files from static, GitHub Pages-compatible chunks.
async function prepareUnityChunks(config, onProgress) {
  const response = await fetch('Build/chunks.json', {cache: 'no-cache'});
  if (!response.ok) throw new Error('Unable to load game manifest (' + response.status + ').');
  const manifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid game manifest.');
  const total = manifest.files.reduce((sum, file) => sum + file.size, 0);
  const objectUrls = [];
  let loaded = 0;
  const release = () => objectUrls.forEach(url => URL.revokeObjectURL(url));
  try {
    for (const file of manifest.files) {
      // Each chunk becomes its own Blob right away and the ArrayBuffer is dropped,
      // so the browser can page the data out to disk instead of holding ~264 MB
      // of JS heap plus a second copy when the final Blob is built.
      const parts = new Array(file.parts.length);
      let next = 0;
      async function worker() {
        while (next < file.parts.length) {
          const index = next++;
          const part = file.parts[index];
          const result = await fetch(new URL(part.url, document.baseURI));
          if (!result.ok) throw new Error('Unable to download game data (' + result.status + ').');
          const data = await result.arrayBuffer();
          if (data.byteLength !== part.size) throw new Error('Incomplete game data. Please reload.');
          parts[index] = new Blob([data]);
          loaded += part.size;
          onProgress(total ? loaded / total : 1);
        }
      }
      await Promise.all(Array.from({length: Math.min(2, file.parts.length)}, worker));
      const size = parts.reduce((sum, blob) => sum + blob.size, 0);
      if (size !== file.size) throw new Error('Incorrect game data size.');
      const type = file.url.endsWith('.wasm') ? 'application/wasm' : file.url.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      const url = URL.createObjectURL(new Blob(parts, {type}));
      objectUrls.push(url);
      let matched = false;
      for (const key of ['dataUrl', 'codeUrl', 'frameworkUrl']) {
        if (new URL(config[key], document.baseURI).href === new URL(file.url, document.baseURI).href) {
          config[key] = url;
          matched = true;
        }
      }
      if (!matched) throw new Error('Unknown game data entry in manifest.');
    }
    onProgress(1);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
