import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orb Music — Find your frequency",
  description: "A mood-first music listening experience.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
