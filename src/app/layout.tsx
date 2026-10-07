import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tareas",
  description: "App de ejemplo para aprender CI/CD",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
