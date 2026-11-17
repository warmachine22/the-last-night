import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build, context } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const development = process.argv.includes('--dev');
const out = path.join(root, development ? '.cache/the-last-night' : 'dist');
const assetDirs = ['assets/art', 'assets/audio', 'assets/guide'];
const options = {
  absWorkingDir: root,
  entryPoints: development ? { game: 'game.js' } : ['game.js'],
  ...(development ? { outdir: out } : { outfile: path.join(out, 'game.js') }),
  target: ['es2022'],
  format: 'esm',
  bundle: true,
  sourcemap: development,
  minify: !development,
  legalComments: 'linked',
  define: { __DEVELOPMENT__: String(development) },
  logLevel: 'info',
};
if (development) {
  await mkdir(out, { recursive: true });
  const publicPaths = ['index.html', 'style.css', ...assetDirs];
  const copy = p => cp(path.join(root, p), path.join(out, p), { recursive: true });
  await Promise.all(publicPaths.map(copy));
  const server = await context(options);
  await server.watch();
  for (const p of publicPaths) {
    let timer;
    watch(path.join(root, p), () => {
      clearTimeout(timer);
      timer = setTimeout(() => copy(p).catch(error => console.warn(error.message)), 120);
    });
  }
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '127.0.0.1';
  await server.serve({ servedir: out, port, host });
} else {
  const result = await build({ ...options, write: false });
  const releaseFiles = new Map(result.outputFiles.map(file => [path.basename(file.path), file.contents]));
  releaseFiles.set('style.css', await readFile(path.join(root, 'style.css')));
  for (const dir of assetDirs) {
    for (const file of await readdir(path.join(root, dir), { withFileTypes: true })) {
      if (file.isFile()) releaseFiles.set(dir + '/' + file.name, await readFile(path.join(root, dir, file.name)));
    }
  }

  const hash = createHash('sha256');
  for (const file of [...releaseFiles.keys()].sort()) {
    const bytes = releaseFiles.get(file);
    hash.update(JSON.stringify([file, bytes.length])).update(bytes);
  }
  const release = 'releases/' + hash.digest('hex').slice(0, 20);
  await Promise.all([...releaseFiles].map(async ([file, contents]) => {
    const target = path.join(out, release, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }));

  const page = await readFile(path.join(root, 'index.html'), 'utf8');
  await writeFile(path.join(out, 'index.html'), page
    .replace('href="./style.css"', 'href="./' + release + '/style.css"')
    .replace('src="./game.js"', 'src="./' + release + '/game.js"'));
  console.log('Built ' + release);
}
