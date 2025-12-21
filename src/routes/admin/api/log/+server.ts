import { query } from '$lib/utils';
import { json } from '@sveltejs/kit';

// Get
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Get logs from D1
	const project_id = new URL(request.url).searchParams.get('project_id');
	if (!project_id) {
		return new Response('Bad Request: Missing project_id', { status: 400 });
	}

	let result = await query(platform, 'SELECT * FROM logs WHERE project_id = ?', [project_id]);

	return json(result);
}
