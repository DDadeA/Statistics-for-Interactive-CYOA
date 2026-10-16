import { query } from '$lib/utils';
import { json } from '@sveltejs/kit';

// Get
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Get logs from D1
	const project_id = new URL(request.url).searchParams.get('project_id');
	if (!project_id) {
		return new Response('Bad Request: Missing project_id', { status: 400 });
	}

	const limitParam = new URL(request.url).searchParams.get('limit');
	const limit = limitParam ? parseInt(limitParam) : 1000; // Default limit to 1000 if not provided

	let result = await query(platform, 'SELECT * FROM logs WHERE project_id = ? LIMIT ?', [
		project_id,
		limit
	]);

	return json(result);
}
