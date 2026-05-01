import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Outreach Tool",
  description: "Outreach automation voor webdesign agency",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          margin: 0,
          padding: 0,
          background: "#0b0d12",
          color: "#e6e8ee",
        }}
      >
        {children}
      </body>
    </html>
  );
}
