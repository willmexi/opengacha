import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { SiteHeader } from "@/components/site-header";
import "./globals.css";

/* The app's two faces: Geist for prose and headings, Geist Mono for every
   label, figure and control. Same pairing as opengacha.io. */

const DESCRIPTION =
  "Open-source gacha storefront for pools on the OpenGacha protocol: pull a real graded card, then keep it or take the buyback.";

/* Where this storefront lives, for absolute share-card URLs: set
   NEXT_PUBLIC_SITE_URL on your host; Vercel's own URL is the fallback, and a
   local dev build just serves relative paths. The card itself is
   app/opengraph-image.png, swap it for your own. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: { default: "OpenGacha", template: "%s" },
  description: DESCRIPTION,
  applicationName: "OpenGacha",
  openGraph: {
    title: "OpenGacha · the registry",
    description: DESCRIPTION,
    siteName: "OpenGacha",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "OpenGacha", description: DESCRIPTION },
};

/* Dark is the default, as on opengacha.io, so only an explicit "light" is
   stamped — before paint, or the page flickers on every load. */
const THEME_BOOT = `try{if(localStorage.theme==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
