import {scanSite} from './scan.js';

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => a.replace(/^--/, '').split('='))
);

if (!args.group) {
	console.error('usage: node src/cli.js --group=<groupId> [--viewport=desktop|mobile] [--language=en_US]');
	process.exit(1);
}

scanSite({groupId: args.group, languageId: args.language, viewport: args.viewport || 'desktop'})
	.then((r) => console.log(JSON.stringify({scanId: r.scanId, score: r.score, violations: r.violations, pages: r.pagesScanned})))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
