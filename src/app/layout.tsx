import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Newl Apps",
  description: "Internal-first, SaaS-ready operations platform for logistics teams"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
