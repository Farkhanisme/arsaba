import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "sonner";
import { PageTransition } from "@/components/ui/page-transition";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "Arsaba V2",
  description: "Aplikasi Absensi & Audit Penjualan Multi-Toko",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={cn("font-sans", geist.variable)}>
      <body>
        <PageTransition>{children}</PageTransition>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}