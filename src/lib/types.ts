interface LogEntry {
	project_id: string;
	uid: string;
	event_type: string;
	current_url: string;
	referrer: string;
	time_on_page: number;
	event_timestamp: string;
	data: any;
	data_hash: string;
	created_at: string;
}
export type { LogEntry };
