import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Passo prospects",
  description: "Private prospect tracker.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
