import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Probable Disco — Paper Trading Platform",
  description: "Local paper-trading day trading platform (development build).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
