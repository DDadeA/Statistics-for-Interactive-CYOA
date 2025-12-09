export const load = async ({ platform }) => {
	const result = await platform.env.DB.prepare(
		`SELECT 
  p.project_id,
  (
    SELECT current_url 
    FROM logs 
    WHERE project_id = p.project_id 
    ORDER BY id DESC 
    LIMIT 1
  ) AS sample_url
FROM projects p;`
	).all();

	return {
		logs: ['a', 'b', 'c']
	};
};
