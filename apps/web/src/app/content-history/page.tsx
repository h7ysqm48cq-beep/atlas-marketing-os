import { ContentHistory } from "@/components/ContentHistory";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export default function ContentHistoryPage() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <ContentHistory />
        </div>
      </main>
    </div>
  );
}
