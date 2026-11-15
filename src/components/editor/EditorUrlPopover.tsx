"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Upload } from "lucide-react";

interface EditorUrlPopoverProps {
  kind: "link" | "image";
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (value: string) => void;
  onUploadImage?: (file: File) => Promise<string>;
  /** Where to show it, relative to the editor: next to the selection it edits. */
  position?: { top?: number; bottom?: number; left: number; maxHeight?: number };
}

/** Uploads use the same stable image URL representation as pasted image links. */
export function EditorUrlPopover({
  kind,
  value,
  onChange,
  onClose,
  onSubmit,
  onUploadImage,
  position,
}: EditorUrlPopoverProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const upload = async (file: File) => {
    if (!onUploadImage) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, GIF, or WebP image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Images must be smaller than 20 MB.");
      return;
    }
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      // Closing the popover or navigating away cancels insertion, even if the
      // network upload has already finished in the background.
      if (mounted.current) onSubmit(url);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "The image could not be uploaded. Try again.");
    } finally {
      if (mounted.current) setUploading(false);
    }
  };
  return (
    <>
      <button className="editor-menu-scrim" aria-label="Close URL input" onClick={onClose} />
      <form
        className="editor-url-input"
        style={position}
        onSubmit={(event) => {
          event.preventDefault();
          if (!uploading) onSubmit(value);
        }}
      >
        <label>{kind === "image" ? "Embed an image" : "Edit link"}</label>
        {kind === "image" && onUploadImage && (
          <div className="editor-image-upload">
            <button
              type="button"
              className="editor-upload-button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <LoaderCircle size={14} className="editor-upload-spinner" /> : <Upload size={14} />}
              {uploading ? "Uploading image…" : "Upload image"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              aria-label="Choose image to upload"
              hidden
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
            <small>PNG, JPEG, GIF, WebP · up to 20 MB</small>
            <span className="editor-upload-divider">or paste a link</span>
          </div>
        )}
        <input
          autoFocus
          type="text"
          aria-label={kind === "image" ? "Image URL" : "Link URL"}
          placeholder="Paste a URL…"
          value={value}
          disabled={uploading}
          onChange={(event) => onChange(event.target.value)}
        />
        {error && (
          <p className="editor-upload-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <small>{kind === "image" ? "A link to an image" : "Leave empty to remove the link"}</small>
          <button type="submit" disabled={uploading}>
            {kind === "image" ? "Insert" : "Apply"}
          </button>
        </div>
      </form>
    </>
  );
}
