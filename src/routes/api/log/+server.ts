import { query, getHash } from '$lib/utils';
import type { RequestHandler } from '@sveltejs/kit';

// Get
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Get logs from D1
	// Get project_id from secret hash

	const secret_key = request.headers.get('Authorization')?.replace('Bearer ', '');
	if (!secret_key) {
		return new Response('Unauthorized', { status: 401 });
	}

	const secret_key_hash = await getHash(secret_key);

	// Get project_id from projects table
	let project = await query(platform, 'SELECT project_id FROM projects WHERE secret_key_hash = ?', [
		secret_key_hash
	]);
	if (project.results.length === 0) {
		// Invalid secret key
		return new Response('Unauthorized', { status: 401 });
	}

	const project_id = project.results[0].project_id;

	let result = await query(platform, 'SELECT * FROM logs WHERE project_id = ?', [project_id]);
	return new Response(JSON.stringify(result));
}

// Post - no authentication
export async function POST({ request, platform }: { request: Request; platform: App.Platform }) {
	try {
		// Get user IP //
		const userIP = request.headers.get('cf-connecting-ip');
		if (!userIP) {
			return new Response('Unable to determine user IP', { status: 400 });
		}
		const userIPHash = await getHash(String(userIP));

		// Get Data //
		const body = await request.json();

		// -- // Validate body
		if (!body.project_id || !body.data) {
			return new Response('Bad Request', { status: 400 });
		}

		// -- // Data validation
		// -- // For now, just ensure data is an object
		if (typeof body.data !== 'object') {
			return new Response('Bad Request: data must be an object', { status: 400 });
		}

		// Insert into D1
		let result = await query(
			platform,
			'INSERT INTO logs (project_id, uid, data, created_at) VALUES (?, ?, ?, ?)',
			[body.project_id, userIPHash, body.data, new Date().toISOString()]
		);

		return new Response('Log entry created', { status: 201 });
	} catch (error) {
		return new Response('Failed to process POST request', {
			status: 500,
			statusText: String(error)
		});
	}
}
