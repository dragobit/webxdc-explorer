import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { AppLayout } from "./components/AppLayout";

import ExplorePage from "./pages/ExplorePage";
import MyAppsPage from "./pages/MyAppsPage";
import WebxdcDetailPage from "./pages/WebxdcDetailPage";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ExplorePage />} />
          <Route path="/apps" element={<MyAppsPage />} />
          <Route path="/app/:i" element={<WebxdcDetailPage />} />
        </Route>
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
