import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
  weight: ["500", "600", "700"],
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SLA Monitor",
  description: "Service reliability & health telemetry",
};

// Applies a persisted theme choice before paint, avoiding a flash of the
// wrong theme. Falls back silently to the OS preference (via the CSS media
// query in globals.css) if localStorage is unavailable — e.g. a private
// window — since that failure must never break rendering.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('sla-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}
      // The theme-init script below sets data-theme before React hydrates,
      // so the server-rendered markup and first client render intentionally
      // differ on this one attribute — expected and safe to suppress here.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
