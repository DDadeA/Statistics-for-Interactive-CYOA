export const load = async ({ platform }) => {
	const result = await platform?.env.DB.prepare(
		`SELECT 
  p.project_id,
  (
    SELECT current_url, created_at
    FROM logs 
    WHERE project_id = p.project_id 
    ORDER BY id DESC 
    LIMIT 1
  ) AS sample_url
FROM projects p;`
	).all();

	// No projects found, might be DB issue
	if (!result) {
		return {
			projects: [
				{
					project_id: 'Missing No.',
					sample_url: 'Backend server is okay, might be database issue.',
					last_updated: 'N/A'
				}
			]
		};
	}

	const projects = result.results.map((row) => ({
		project_id: row.project_id as string,
		sample_url: row.sample_url as string,
		last_updated: row.created_at as string
	}));

	// Sort by last_updated in descending order
	return {
		projects: projects.sort((a, b) => (b.last_updated ?? '').localeCompare(a.last_updated ?? ''))
	};
};
