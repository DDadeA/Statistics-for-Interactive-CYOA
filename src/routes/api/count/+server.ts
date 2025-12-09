import { query } from '$lib/utils';

export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Return COUNT(*) from all logs
	const result = await query(
		platform,
		`SELECT 
  SUM(
    CASE 
      WHEN time_on_page > 10800000 THEN 10800000 
      ELSE time_on_page 
    END
  ) as adjusted_total_time
FROM logs`
	);

	const adjustedTotalTime = result.results[0]?.adjusted_total_time || 0;
	return new Response(JSON.stringify({ adjustedTotalTime }), {
		status: 200,
		headers: {
			'Cache-Control': 'public, max-age=600',
			'Content-Type': 'application/json'
		}
	});
}
