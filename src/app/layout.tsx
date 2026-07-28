import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Probable Disco — Paper Trading Platform",
  description: "Local paper-trading day trading platform (development build).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-950 text-slate-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
