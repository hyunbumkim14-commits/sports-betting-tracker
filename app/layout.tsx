import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ✅ Mobile viewport (explicit)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// ✅ Update these anytime
export const metadata: Metadata = {
  title: "Sports Betting Tracker",
  description: "Track bets, profit, ROI, and bankroll over time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* App wrapper: prevents edge-to-edge + keeps consistent spacing */}
        <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
          {children}
        </div>
      </body>
    </html>
  );
}