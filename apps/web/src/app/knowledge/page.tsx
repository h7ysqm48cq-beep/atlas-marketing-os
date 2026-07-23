import { Header } from "@/components/Header";
import { KnowledgeLibrary } from "@/components/knowledge/KnowledgeLibrary";
import { Sidebar } from "@/components/Sidebar";

export default function KnowledgePage() {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />

        <div className="page-content">
          <KnowledgeLibrary />
        </div>
      </main>
    </div>
  );
}
