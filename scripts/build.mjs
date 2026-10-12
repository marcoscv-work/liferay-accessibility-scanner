/**
 * Builds every client extension under client-extensions/ into dist/<name>.zip
 * using the same layout the Liferay workspace produces, so the zips deploy to
 * <bundles>/osgi/client-extensions on self-hosted and to LXC as they are.
 *
 *   node scripts/build.mjs            build
 *   node scripts/build.mjs --deploy   build and copy to $LIFERAY_BUNDLES/osgi/client-extensions
 *   node scripts/build.mjs --watch    rebuild (and deploy) on change
 */

import {execSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import * as esbuild from 'esbuild';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CX_DIR = path.join(ROOT, 'client-extensions');
const DIST = path.join(ROOT, 'dist');

const args = new Set(process.argv.slice(2));
const deploy = args.has('--deploy');
const watch = args.has('--watch');

const bundles =
	process.env.LIFERAY_BUNDLES || path.join(os.homedir(), 'projects', 'bundles');

const DOCKERFILE = 'FROM liferay/caddy:latest\n\nCOPY static/ /public_html/\n';

function lcp(id) {
	return JSON.stringify(
		{
			cpu: 0.05,
			env: {
				LIFERAY_ROUTES_CLIENT_EXTENSION: '/etc/liferay/lxc/ext-init-metadata',
				LIFERAY_ROUTES_DXP: '/etc/liferay/lxc/dxp-metadata',
			},
			environments: {
				dev: {loadBalancer: {cdn: false, targetPort: 80}},
				infra: {deploy: false},
			},
			id,
			kind: 'Deployment',
			livenessProbe: {httpGet: {path: '/', port: 80}},
			loadBalancer: {cdn: true, targetPort: 80},
			memory: 50,
			readinessProbe: {httpGet: {path: '/', port: 80}},
			scale: 1,
		},
		null,
		'\t'
	);
}

const RESERVED = new Set(['assemble', 'runtime']);
const COMMON_KEYS = new Set(['description', 'name', 'sourceCodeURL', 'type']);

function hashify(file) {
	const content = fs.readFileSync(file);
	const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
	const ext = path.extname(file);
	const target = file.replace(new RegExp(`${ext}$`), `.${hash}${ext}`);
	fs.renameSync(file, target);
	return path.basename(target);
}

async function bundleEntry(entry, outDir, define = {}) {
	await esbuild.build({
		bundle: true,
		define,
		entryPoints: [entry],
		format: 'iife',
		legalComments: 'none',
		logLevel: 'warning',
		minify: true,
		outdir: outDir,
		sourcemap: false,
		target: ['es2020'],
	});
	const name = path.basename(entry, path.extname(entry));
	return hashify(path.join(outDir, `${name}.js`));
}

/**
 * Bundles src/index.js. When src/scanner.js exists it is bundled first and
 * its hashed file name is injected into index.js as __SCANNER_FILE__, so the
 * entry can stay a tiny loader and fetch the heavy bundle on demand.
 */
async function bundle(cxDir) {
	const entry = path.join(cxDir, 'src', 'index.js');
	if (!fs.existsSync(entry)) {
		return [];
	}
	const outDir = path.join(cxDir, 'build', 'static');
	fs.rmSync(outDir, {force: true, recursive: true});

	const built = [];
	const define = {};
	const scanner = path.join(cxDir, 'src', 'scanner.js');
	if (fs.existsSync(scanner)) {
		const file = await bundleEntry(scanner, outDir);
		built.push(file);
		define.__SCANNER_FILE__ = JSON.stringify(file);
	}
	built.push(await bundleEntry(entry, outDir, define));
	return built;
}

function toTypeSettings(cx, builtFiles) {
	const settings = [];
	for (const [key, value] of Object.entries(cx)) {
		if (COMMON_KEYS.has(key) || key === 'entryName') {
			continue;
		}
		let v = value;
		if (key === 'url' || key === 'urls') {
			const resolve = (pattern) => {
				const re = new RegExp(
					'^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
				);
				return builtFiles.find((f) => re.test(f)) || pattern;
			};
			v = Array.isArray(value) ? value.map(resolve) : resolve(value);
		}
		if (Array.isArray(v)) {
			settings.push(`${key}=${v.join('\n')}`);
		}
		else if (typeof v === 'object') {
			settings.push(`${key}=${JSON.stringify(v)}`);
		}
		else {
			settings.push(`${key}=${v}`);
		}
	}
	return settings;
}

async function buildOne(name) {
	const cxDir = path.join(CX_DIR, name);
	const yamlFile = path.join(cxDir, 'client-extension.yaml');
	if (!fs.existsSync(yamlFile)) {
		return;
	}
	// A client extension that ships its own Dockerfile (a microservice) is
	// packaged by LXC from its sources; this script only builds static ones.
	if (fs.existsSync(path.join(cxDir, 'Dockerfile'))) {
		console.log(`skipped ${name} (microservice, deploy it to LXC from its folder)`);
		return;
	}
	const doc = YAML.parse(fs.readFileSync(yamlFile, 'utf8'));
	const stage = path.join(DIST, 'stage', name);
	fs.rmSync(stage, {force: true, recursive: true});
	fs.mkdirSync(path.join(stage, 'static'), {recursive: true});

	const cxEntries = Object.entries(doc).filter(([k]) => !RESERVED.has(k));
	const config = {};
	const projectId = name.replace(/[^a-z0-9]/gi, '').toLowerCase();

	for (const [id, cx] of cxEntries) {
		const builtFiles = await bundle(cxDir);
		const buildDir = path.join(cxDir, 'build', 'static');
		if (fs.existsSync(buildDir)) {
			fs.cpSync(buildDir, path.join(stage, 'static'), {recursive: true});
		}
		for (const step of doc.assemble || []) {
			const from = path.join(cxDir, step.from);
			if (fs.existsSync(from) && step.from !== 'build/static') {
				fs.cpSync(from, path.join(stage, step.into || 'static'), {
					recursive: true,
				});
			}
		}
		config[
			`com.liferay.client.extension.type.configuration.CETConfiguration~${id}`
		] = {
			':configurator:policy': 'force',
			baseURL: `\${portalURL}/o/${name}`,
			buildTimestamp: Date.now(),
			description: cx.description || '',
			'dxp.lxc.liferay.com.virtualInstanceId': 'default',
			name: cx.name,
			projectId,
			projectName: name,
			properties: [],
			sourceCodeURL: cx.sourceCodeURL || '',
			type: cx.type,
			typeSettings: toTypeSettings(cx, builtFiles),
		};
	}

	fs.writeFileSync(
		path.join(stage, `${name}.client-extension-config.json`),
		JSON.stringify(config, null, '\t')
	);
	// The WAB generator derives the OSGi module id from these properties; without
	// them the zip is rejected with "The moduleId ... is not correct".
	const hasBatch = fs.existsSync(path.join(stage, 'batch'));
	const hasStatic = fs.readdirSync(path.join(stage, 'static')).length > 0;
	if (!hasStatic) {
		fs.rmSync(path.join(stage, 'static'), {recursive: true});
	}
	fs.mkdirSync(path.join(stage, 'WEB-INF'));
	fs.writeFileSync(
		path.join(stage, 'WEB-INF', 'liferay-plugin-package.properties'),
		[
			`Bundle-SymbolicName=${projectId}`,
			hasBatch ? 'Liferay-Client-Extension-Batch=batch/' : null,
			hasStatic ? 'Liferay-Client-Extension-Frontend=static/' : null,
			'module-group-id=liferay',
			`name=${name}`,
			'',
		]
			.filter((line) => line !== null)
			.join('\n')
	);
	fs.writeFileSync(path.join(stage, 'Dockerfile'), DOCKERFILE);
	fs.writeFileSync(path.join(stage, 'LCP.json'), lcp(projectId));

	const zip = path.join(DIST, `${name}.zip`);
	fs.rmSync(zip, {force: true});
	execSync(`zip -qr "${zip}" .`, {cwd: stage});
	console.log(`built ${path.relative(ROOT, zip)}`);

	if (deploy) {
		const target = path.join(bundles, 'osgi', 'client-extensions');
		fs.mkdirSync(target, {recursive: true});
		fs.copyFileSync(zip, path.join(target, path.basename(zip)));
		console.log(`deployed -> ${path.join(target, path.basename(zip))}`);
	}
}

async function buildAll() {
	fs.mkdirSync(DIST, {recursive: true});
	for (const name of fs.readdirSync(CX_DIR)) {
		await buildOne(name);
	}
}

await buildAll();

if (watch) {
	console.log('watching client-extensions/**/src ...');
	let timer;
	fs.watch(CX_DIR, {recursive: true}, (_event, file) => {
		if (!file || file.includes('/build/')) {
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => buildAll().catch(console.error), 200);
	});
}
