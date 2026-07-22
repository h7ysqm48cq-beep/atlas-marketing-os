import { BrandBrain } from "@/components/BrandBrain";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export default function BrandBrainPage() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <BrandBrain />
        </div>
      </main>
    </div>
  );
}
