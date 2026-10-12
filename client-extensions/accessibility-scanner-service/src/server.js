/**
 * HTTP entry point. LXC calls POST /scan from the "Run scan" object action on
 * AccessibilityScan; the body is the object entry, whose siteGroupId says which site.
 * GET /health is the liveness probe.
 */

import http from 'node:http';

import {scanSite} from './scan.js';

const port = Number(process.env.PORT || 58082);
const jobs = new Map();

function json(response, status, body) {
	response.writeHead(status, {'Content-Type': 'application/json'});
	response.end(JSON.stringify(body));
}

http.createServer(async (request, response) => {
	const url = new URL(request.url, `http://${request.headers.host}`);

	if (request.method === 'GET' && url.pathname === '/health') {
		return json(response, 200, {status: 'ok'});
	}

	if (request.method === 'GET' && url.pathname.startsWith('/scans/')) {
		const job = jobs.get(url.pathname.split('/')[2]);
		return job ? json(response, 200, job) : json(response, 404, {error: 'unknown job'});
	}

	if (request.method === 'POST' && url.pathname === '/scan') {
		let body = '';
		for await (const chunk of request) {
			body += chunk;
		}
		let payload = {};
		try {
			payload = body ? JSON.parse(body) : {};
		}
		catch {
			return json(response, 400, {error: 'invalid JSON'});
		}
		const groupId =
			payload.groupId || payload.objectEntry?.values?.siteGroupId || payload.siteGroupId;
		if (!groupId) {
			return json(response, 400, {error: 'groupId (or objectEntry.values.siteGroupId) is required'});
		}
		const id = `${Date.now()}`;
		const job = {groupId, id, log: [], status: 'running'};
		jobs.set(id, job);
		scanSite({
			groupId,
			languageId: payload.languageId,
			log: (line) => job.log.push(line),
			trigger: payload.objectEntry ? 'object-action' : 'api',
			viewport: payload.viewport,
		})
			.then((result) => Object.assign(job, {result, status: 'completed'}))
			.catch((error) => Object.assign(job, {error: error.message, status: 'failed'}));
		return json(response, 202, {id, status: 'running'});
	}

	json(response, 404, {error: 'not found'});
}).listen(port, () => console.log(`accessibility scanner service listening on ${port}`));
