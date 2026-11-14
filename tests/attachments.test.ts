import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configured: true, browserClient: vi.fn(), serverClient: vi.fn() }));
vi.mock('../src/lib/supabase/client', () => ({ get isSupabaseConfigured() { return mocks.configured; }, getSupabaseClient: mocks.browserClient }));
vi.mock('../src/lib/supabase/server', () => ({ createClient: mocks.serverClient }));
import { attachmentPath, MAX_IMAGE_SIZE, uploadImage, validateImageFile } from '../src/lib/attachments';
import { GET } from '../src/app/api/attachments/[id]/route';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000000002';
const imageId = '00000000-0000-4000-8000-000000000003';
const validPng = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'photo.png', { type: 'image/png' });
const auth = { getUser: vi.fn() };
const storage = { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() };
const pagesQuery = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn() };
const attachmentsQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn() };
const client = { auth, storage: { from: vi.fn() }, from: vi.fn() };
const access = (id = imageId) => GET(new Request(`http://localhost/api/attachments/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key');
  mocks.browserClient.mockReturnValue(client);
  mocks.serverClient.mockResolvedValue(client);
  auth.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
  client.storage.from.mockReturnValue(storage);
  client.from.mockImplementation((table: string) => table === 'pages' ? pagesQuery : attachmentsQuery);
  for (const method of ['select', 'eq', 'is'] as const) pagesQuery[method].mockReturnValue(pagesQuery);
  for (const method of ['select', 'eq'] as const) attachmentsQuery[method].mockReturnValue(attachmentsQuery);
  pagesQuery.maybeSingle.mockResolvedValue({ data: { id: pageId }, error: null });
  attachmentsQuery.maybeSingle.mockResolvedValue({ data: { page_id: pageId, workspace_id: workspaceId, mime_type: 'image/png', storage_path: attachmentPath(workspaceId, pageId, imageId, 'image/png') }, error: null });
  attachmentsQuery.insert.mockResolvedValue({ data: null, error: null });
  storage.upload.mockResolvedValue({ error: null });
  storage.remove.mockResolvedValue({ error: null });
  storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://example.supabase.co/storage/v1/object/sign/attachments/photo.png?token=short-lived' }, error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe('private image uploads', () => {
  it('validates file format, empty/oversized files and storage scope', async () => {
    await expect(validateImageFile(validPng())).resolves.toBeUndefined();
    await expect(validateImageFile(new File(['<svg/>'], 'picture.svg', { type: 'image/svg+xml' }))).rejects.toThrow('PNG');
    await expect(validateImageFile(new File(['<html/>'], 'picture.png', { type: 'image/png' }))).rejects.toThrow('does not match');
    await expect(validateImageFile(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow('empty');
    const large = validPng();
    Object.defineProperty(large, 'size', { value: MAX_IMAGE_SIZE + 1 });
    await expect(validateImageFile(large)).rejects.toThrow('20 MB');
    expect(() => attachmentPath('../other-user', pageId, imageId, 'image/png')).toThrow('destination');
  });
  it('uploads into the private workspace path and stores a stable route, without signed tokens in documents', async () => {
    const url = await uploadImage(validPng(), pageId, workspaceId);
    expect(url).toMatch(/^\/api\/attachments\/[a-f0-9-]{36}$/);
    expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${workspaceId}/${pageId}/[a-f0-9-]+\\.png$`)), expect.any(File), { contentType: 'image/png', upsert: false, cacheControl: '0' });
    expect(attachmentsQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ page_id: pageId, workspace_id: workspaceId, mime_type: 'image/png', size: 9 }));
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it('rolls back storage when attachment metadata cannot be saved', async () => {
    attachmentsQuery.insert.mockResolvedValue({ error: { message: 'Page was deleted' } });
    await expect(uploadImage(validPng(), pageId, workspaceId)).rejects.toThrow('could not be attached');
    expect(storage.remove).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
    attachmentsQuery.insert.mockRejectedValue(new Error('Network interrupted'));
    await expect(uploadImage(validPng(), pageId, workspaceId)).rejects.toThrow('could not be attached');
    expect(storage.remove).toHaveBeenCalledTimes(2);
  });
  it('rejects missing configuration, expired sessions and unsaved or inaccessible pages before upload', async () => {
    mocks.configured = false;
    await expect(uploadImage(validPng(), pageId, workspaceId)).rejects.toThrow('Configure Supabase');
    mocks.configured = true;
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(uploadImage(validPng(), pageId, workspaceId)).rejects.toThrow('Sign in');
    auth.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
    pagesQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(uploadImage(validPng(), pageId, workspaceId)).rejects.toThrow('Save this page');
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('authenticated attachment access', () => {
  it('verifies ownership through RLS before issuing a short-lived private redirect', async () => {
    const response = await access();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('short-lived');
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(storage.createSignedUrl).toHaveBeenCalledWith(attachmentPath(workspaceId, pageId, imageId, 'image/png'), 60);
    expect(pagesQuery.eq).toHaveBeenCalledWith('workspace_id', workspaceId);
    expect(pagesQuery.is).not.toHaveBeenCalled();
  });
  it('keeps attachment references usable in copied pages when their source page is in recoverable Trash', async () => {
    pagesQuery.maybeSingle.mockResolvedValue({ data: { id: pageId, deleted_at: '2026-11-11T10:00:00Z' }, error: null });
    expect((await access()).status).toBe(307);
    expect(storage.createSignedUrl).toHaveBeenCalledOnce();
  });
  it('does not sign URLs for signed-out users, missing or foreign rows, removed pages or altered paths', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await access()).status).toBe(401);
    auth.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
    attachmentsQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await access()).status).toBe(404);
    attachmentsQuery.maybeSingle.mockResolvedValue({ data: { page_id: pageId, workspace_id: workspaceId, mime_type: 'image/png', storage_path: 'another-workspace/secret.png' }, error: null });
    expect((await access()).status).toBe(404);
    attachmentsQuery.maybeSingle.mockResolvedValue({ data: { page_id: pageId, workspace_id: workspaceId, mime_type: 'image/png', storage_path: attachmentPath(workspaceId, pageId, imageId, 'image/png') }, error: null });
    pagesQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await access()).status).toBe(404);
    expect((await access('../bad-path')).status).toBe(404);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});
