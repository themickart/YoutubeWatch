import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const template = await read('src/ui.html');
const styles = await read('src/styles.css');
const video = (await read('src/video.mjs')).replace(/^export /gm, '');
const app = await read('src/ui.js');
const output = template.replace('/* INLINE_STYLES */', () => styles)
  .replace('/* INLINE_SCRIPT */', () => `${video}\n${app}`);
await writeFile(new URL('ui.html', root), output);
console.log('Built ui.html — import manifest.json in Figma. No runtime dependencies.');
