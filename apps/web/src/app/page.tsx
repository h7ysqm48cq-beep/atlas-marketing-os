import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { KpiCard } from "@/components/KpiCard";
import { AiRecommendation } from "@/components/AiRecommendation";
import { TodaySchedule } from "@/components/TodaySchedule";
import { QuickActions } from "@/components/QuickActions";
import { ContentPipeline } from "@/components/ContentPipeline";

const kpis = [
  { label: "Content This Week", value: "18", change: "+12%", icon: "✦" },
  { label: "Active Campaigns", value: "3", change: "2 on track", icon: "◉" },
  { label: "Pending Review", value: "5", change: "Needs attention", icon: "⌁" },
  { label: "Published Today", value: "12", change: "+3 vs yesterday", icon: "↗" },
];

export default function Home() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <section className="hero-section">
            <div>
              <p className="eyebrow">Tuesday, 22 July</p>
              <h1>Good evening, Loh.</h1>
              <p className="hero-copy">
                Here is what is happening across your marketing workspace today.
              </p>
            </div>
            <button className="primary-button">+ Create content</button>
          </section>

          <section className="kpi-grid">
            {kpis.map((item) => (
              <KpiCard key={item.label} {...item} />
            ))}
          </section>

          <section className="dashboard-grid">
            <div className="dashboard-column dashboard-column-wide">
              <AiRecommendation />
              <ContentPipeline />
            </div>
            <div className="dashboard-column">
              <TodaySchedule />
              <QuickActions />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
