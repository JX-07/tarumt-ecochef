import { MerchantShell } from "./components/merchant-shell";
import { VendorProvider } from "./components/vendor-context";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <VendorProvider>
      <MerchantShell>{children}</MerchantShell>
    </VendorProvider>
  );
}
