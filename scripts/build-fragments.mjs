/**
 * Packs fragments/<collection> into dist/<collection>-fragments.zip with the
 * layout the Fragments importer expects: <key>/collection.json,
 * <key>/fragments/<fragment-key>/*, <key>/resources/*.
 */
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'fragments');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, {recursive: true});

for (const collection of fs.readdirSync(SRC)) {
	const dir = path.join(SRC, collection);
	if (!fs.existsSync(path.join(dir, 'collection.json'))) {
		continue;
	}
	const zip = path.join(DIST, `${collection}-fragments.zip`);
	fs.rmSync(zip, {force: true});
	execSync(`zip -qr "${zip}" "${collection}" -x '*.DS_Store'`, {cwd: SRC});
	console.log(`built ${path.relative(ROOT, zip)}`);
}
