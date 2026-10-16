import { query } from '$lib/utils';
import { json } from '@sveltejs/kit';

// Get
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Get logs from D1
	const project_id = new URL(request.url).searchParams.get('project_id');
	const limit = new URL(request.url).searchParams.get('limit') || '5000';
	if (!project_id) {
		// Return all projects with only project_id, created_at
		let result = await query(
			platform,
			'SELECT project_id, created_at FROM logs ORDER BY created_at DESC LIMIT ?',
			[limit]
		);
		return json(result);
	}

	let result = await query(
		platform,
		'SELECT * FROM logs WHERE project_id = ? ORDER BY id DESC LIMIT ?',
		[project_id, limit]
	);

	return json(result);
}
