import type { Metadata, Viewport } from 'next';
import { ThemedToaster } from '@/components/theme-switcher';
import { themeScript, viewportScript } from '@/lib/theme-script';
import { InlineScript } from '@/components/inline-script';
import './globals.css';
// Workspace routes render <title> themselves (page data is client-side); auth routes set metadata.
export const metadata: Metadata = {
  description: 'A quiet place for your notes, ideas, and everything in between. A private knowledge workspace with documents and relational databases.',
};
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#191919' },
  ],
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script sets data-theme before React hydrates, hence the warning opt-out.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <InlineScript html={themeScript} />
        <InlineScript html={viewportScript} />
      </head>
      <body>
        {children}
        <ThemedToaster />
      </body>
    </html>
  );
}
