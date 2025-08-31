import { query, getHash } from '$lib/utils';

export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Generate project_id / secret key
	const project_id = crypto.randomUUID();
	const secret_key = crypto.randomUUID();

	const secret_key_hash = await getHash(secret_key);

	// Store in D1
	let result = await query(
		platform,
		'INSERT INTO projects (project_id, secret_key_hash, created_at) VALUES (?, ?, ?)',
		[project_id, secret_key_hash, new Date().toISOString()]
	);

	return new Response(JSON.stringify({ project_id, secret_key }));
}
