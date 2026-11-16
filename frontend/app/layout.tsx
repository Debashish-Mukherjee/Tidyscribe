import type { Metadata } from "next";
import "./globals.css";
import { runtimeConfigScript } from "../lib/config";
import { PREVIEW_CSS } from "../lib/preview-styles";
import { themeInitScript } from "../lib/theme";

// Rendered per request so API_URL is read when the container starts, not when the image is built.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tidyscribe",
  description: "Transform AI-generated content into polished technical documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript(process.env.API_URL) }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style dangerouslySetInnerHTML={{ __html: PREVIEW_CSS }} />
      </head>
      <body className="bg-[#0d1117] text-[#c9d1d9] antialiased">{children}</body>
    </html>
  );
}
