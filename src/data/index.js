// Picks the backend. Default is mock so the demo runs anywhere before Supabase exists.
const mode = (import.meta.env.VITE_DATA_MODE || 'mock').toLowerCase();

export async function loadBackend() {
  if (mode === 'supabase') {
    const { createSupabaseBackend } = await import('./supabase.js');
    return createSupabaseBackend({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
    });
  }
  const { createMockBackend } = await import('./mock.js');
  return createMockBackend();
}
