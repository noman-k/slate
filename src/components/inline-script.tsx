/**
 * An inline script that runs during HTML parsing (before first paint) without React's
 * "script tag while rendering" warning: executable on the server, inert text on the client.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
