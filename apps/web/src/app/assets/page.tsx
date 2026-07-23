import { AssetLibrary } from "@/components/AssetLibrary";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export default function AssetsPage() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <AssetLibrary />
        </div>
      </main>
    </div>
  );
}
