import { getSupabaseClient, isSupabaseConfigured } from './supabase/client';

export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAttachmentId(value: string): boolean { return uuidPattern.test(value); }

export function attachmentPath(workspaceId: string, pageId: string, attachmentId: string, mimeType: string): string {
  if (![workspaceId, pageId, attachmentId].every(isAttachmentId) || !Object.hasOwn(extensions, mimeType)) throw new Error('Invalid attachment destination.');
  return `${workspaceId}/${pageId}/${attachmentId}.${extensions[mimeType]}`;
}

/** Reject mislabeled files before storing them in the private image bucket. */
export async function validateImageFile(file: File): Promise<void> {
  if (!Object.hasOwn(extensions, file.type)) throw new Error('Choose a PNG, JPEG, GIF, or WebP image.');
  if (file.size === 0) throw new Error('This image is empty. Choose another file.');
  if (file.size > MAX_IMAGE_SIZE) throw new Error('Images must be 20 MB or smaller.');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  const valid = file.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : file.type === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(text(0, 6))
    : text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP';
  if (!valid) throw new Error('This file does not match its image type. Choose a valid image.');
}

/** Upload objects privately; documents store a stable authenticated application URL. */
export async function uploadImage(file: File, pageId: string, workspaceId: string): Promise<string> {
  if (!isSupabaseConfigured) throw new Error('Configure Supabase to upload images to your private workspace.');
  await validateImageFile(file);
  const attachmentId = crypto.randomUUID();
  const path = attachmentPath(workspaceId, pageId, attachmentId, file.type);
  const supabase = getSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Sign in to upload an image.');
  const { data: page, error: pageError } = await supabase.from('pages').select('id').eq('id', pageId).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle();
  if (pageError || !page) throw new Error('Save this page before uploading an image, then try again.');
  const storage = supabase.storage.from('attachments');
  const { error: uploadError } = await storage.upload(path, file, { contentType: file.type, upsert: false, cacheControl: '0' });
  if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
  try {
    const { error } = await supabase.from('attachments').insert({ id: attachmentId, workspace_id: workspaceId, page_id: pageId, storage_path: path, name: file.name.slice(0, 250), mime_type: file.type, size: file.size });
    if (error) throw error;
  } catch {
    let cleanupFailed = false;
    try { const { error } = await storage.remove([path]); cleanupFailed = Boolean(error); } catch { cleanupFailed = true; }
    throw new Error(cleanupFailed ? 'Your image could not be attached, and its temporary upload could not be removed. Please try again.' : 'Your image could not be attached. Check that this page is saved and try again.');
  }
  return `/api/attachments/${attachmentId}`;
}
