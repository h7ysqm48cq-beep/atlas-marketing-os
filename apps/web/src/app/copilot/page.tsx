import { BrandCopilot } from '@/components/BrandCopilot';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';

export default function CopilotPage() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content"><BrandCopilot /></div>
      </main>
    </div>
  );
}
