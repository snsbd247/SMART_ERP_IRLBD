import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { TopNavbar } from "@/components/TopNavbar";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CommandPalette } from "@/components/CommandPalette";
import { BrandingFooter } from "@/components/BrandingFooter";
import { ChunkRetryIndicator } from "@/components/ChunkRetryIndicator";
import { LicenseGraceBanner } from "@/components/LicenseGraceBanner";
import { LicenseExpiryWarningDialog } from "@/components/LicenseExpiryWarningDialog";

export const AppLayout = () => {
  return (
    // print: drop the app chrome and let the page content flow across
    // pages (h-screen/overflow would otherwise clip it to one screen).
    <div className="flex h-screen bg-background w-full overflow-hidden print:block print:h-auto print:overflow-visible">
      <div className="contents print:hidden">
        <AppSidebar />
      </div>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden print:block print:overflow-visible">
        <div className="contents print:hidden">
          <TopNavbar />
          <LicenseGraceBanner />
          <Breadcrumbs />
        </div>
        <main className="flex-1 overflow-auto overscroll-contain print:overflow-visible">
          <Outlet />
        </main>
        <div className="contents print:hidden">
          <BrandingFooter />
        </div>
      </div>
      <CommandPalette />
      <ChunkRetryIndicator />
      <LicenseExpiryWarningDialog />
    </div>
  );
};
