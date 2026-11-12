import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@ecochef/design-tokens/tokens.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "EcoChef Portal",
  description: "EcoChef administrator and Business portal.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
