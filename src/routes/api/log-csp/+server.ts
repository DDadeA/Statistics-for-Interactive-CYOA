import { query, getHash } from '$lib/utils';
import type { RequestHandler } from '@sveltejs/kit';

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('Origin');

	return new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': origin || '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Allow-Credentials': 'true',
			Vary: 'Origin'
		}
	});
};

// GET - no authentication
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	const origin = request.headers.get('Origin');
	const corsHeaders = {
		'Access-Control-Allow-Origin': origin || '*',
		'Access-Control-Allow-Credentials': 'true',
		Vary: 'Origin'
	};

	try {
		// Get user IP //
		const userIP = request.headers.get('cf-connecting-ip');
		if (!userIP) {
			return new Response('Unable to determine user IP', { status: 400, headers: corsHeaders });
		}
		const userIPHash = await getHash(String(userIP), platform.env.pepper);

		// Get Data //
		const url = new URL(request.url);
		const projectId = url.searchParams.get('projectId');
		let data = url.searchParams.get('data');

		// -- // Validate body
		if (!projectId || !data) {
			return new Response('Bad Request', { status: 400, headers: corsHeaders });
		}

		// -- // Data validation
		// -- // Skip for now
		// if (typeof body.data !== 'object') {
		// 	return new Response('Bad Request: data must be an object', { status: 400 });
		// }
		if (typeof data !== 'string') {
			data = JSON.stringify(data);
		}

		// Insert into D1 - log_type 2 for CSP
		let result = await query(
			platform,
			'INSERT INTO logs (project_id, uid, data, created_at, log_type, data_hash) VALUES (?, ?, ?, ?, ?, ?)',
			[
				projectId,
				userIPHash,
				data,
				new Date().toISOString(),
				2,
				await getHash(data, platform.env.pepper)
			]
		);

		return new Response('Log entry created', { status: 201, headers: corsHeaders });
	} catch (error) {
		return new Response(String(error), { status: 500, headers: corsHeaders });
	}
}
