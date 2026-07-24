import type { Metadata, Viewport } from "next";
import { Archivo_Black, Permanent_Marker, Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const marker = Permanent_Marker({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-marker",
  display: "swap",
});

const body = Space_Grotesk({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CRASHOUT — rant to your heart's content",
  description:
    "The anonymous wall of rage. Type it, throw it, watch it crash into everyone else's. No names. No logins. Just feelings.",
  openGraph: {
    title: "CRASHOUT",
    description: "Rant to your heart's content. Anonymous. Cathartic. Bouncy.",
    type: "website",
  },
  icons: { icon: "/logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${marker.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
