import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { attachmentPath, isAttachmentId } from "@/lib/attachments";

export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

/** Each access verifies the current cookie session and owner-scoped metadata before signing. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAttachmentId(id)) return failure("Attachment not found.", 404);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return failure("Private image storage is not configured.", 503);
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return failure("Sign in to access this image.", 401);
    const { data: attachment, error: metadataError } = await supabase
      .from("attachments")
      .select("storage_path,page_id,workspace_id,mime_type")
      .eq("id", id)
      .maybeSingle();
    if (metadataError) return failure("Unable to load this image.", 503);
    if (!attachment) return failure("Attachment not found.", 404);
    // Trash is recoverable, and copied documents may reference the same attachment.
    const { data: page, error: pageError } = await supabase
      .from("pages")
      .select("id")
      .eq("id", attachment.page_id)
      .eq("workspace_id", attachment.workspace_id)
      .maybeSingle();
    if (pageError) return failure("Unable to load this image.", 503);
    if (!page) return failure("Attachment not found.", 404);
    // Validate the scope again before handing the path to Storage's independent RLS checks.
    let expectedPath: string;
    try {
      expectedPath = attachmentPath(attachment.workspace_id, attachment.page_id, id, attachment.mime_type);
    } catch {
      return failure("Attachment not found.", 404);
    }
    if (attachment.storage_path !== expectedPath) return failure("Attachment not found.", 404);
    const { data, error } = await supabase.storage.from("attachments").createSignedUrl(attachment.storage_path, 60);
    if (error || !data?.signedUrl) return failure("Unable to load this image.", 503);
    const response = NextResponse.redirect(data.signedUrl, 307);
    for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
    return response;
  } catch {
    return failure("Unable to load this image. Try again.", 503);
  }
}
