import type { Metadata } from "next";
import { Cormorant_Garamond, Space_Grotesk } from "next/font/google";

import { AuthProvider } from "@/components/auth-provider";
import { APP_NAME } from "@/lib/constants";
import "@/app/globals.css";

const headingFont = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading"
});

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: `${APP_NAME} · Your private memory studio`,
  description:
    "Create private diary-style films and cinematic wall-frame memory montages from your own photos, videos, and MP3 soundtracks."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable} font-sans`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
