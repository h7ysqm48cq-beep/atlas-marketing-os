import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { AiStudio } from "@/components/AiStudio";

export default function AiStudioPage() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <AiStudio />
        </div>
      </main>
    </div>
  );
}
