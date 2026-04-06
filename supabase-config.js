const SUPABASE_URL = "https://xjubuewqbueyesflqxrl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqdWJ1ZXdxYnVleWVzZmxxeHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0OTkwODcsImV4cCI6MjA5MTA3NTA4N30.6kk9Fm9AB2P-V4XrSdl88UelEqJ2EgDXyD7AWAcBnz4";

// Initialize Supabase Client
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.sb = _supabase;
