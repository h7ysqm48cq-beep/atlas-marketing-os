import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { ContentCalendar } from "@/components/calendar/ContentCalendar";

export default function CalendarPage() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <ContentCalendar />
        </div>
      </main>
    </div>
  );
}
