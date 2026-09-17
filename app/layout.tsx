import "./globals.css";

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
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}