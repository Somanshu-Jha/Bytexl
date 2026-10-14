import type { Bootstrap, ChatResponse, HealthRecord, Patient, UploadJob } from '../shared/types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  upload: (file: File, handwriting = false) => { const form = new FormData(); form.append('file', file); form.append('consent', 'true'); form.append('handwriting', String(handwriting)); return request<UploadJob>('/records', { method: 'POST', body: form }); },
  job: (id: string) => request<UploadJob>(`/jobs/${encodeURIComponent(id)}`),
  updateRecord: (id: string, body: Partial<HealthRecord> & { acknowledgeOcrWarnings?: boolean }) => request<HealthRecord>(`/records/${encodeURIComponent(id)}`, json(body, 'PATCH')),
  deleteRecord: (id: string) => request<void>(`/records/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chat: (message: string, language: string) => request<ChatResponse>('/chat', json({ message, language })),
  patient: (body: Partial<Patient>) => request<Patient>('/patient', json(body, 'PATCH')),
  reset: () => request<Bootstrap>('/demo/reset', json({})),
};
