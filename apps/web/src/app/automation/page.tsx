import { AutomationDashboard } from "@/components/automation/AutomationDashboard";
import { SportsNewsSettings } from "@/components/automation/SportsNewsSettings";
import { AppLayout } from "@/components/AppLayout";

export default function AutomationPage() {
  return (
    <AppLayout>
      <AutomationDashboard />
      <div style={{ marginTop: 24 }}>
        <SportsNewsSettings />
      </div>
    </AppLayout>
  );
}
