import {
  AppLayout,
} from "@/components/AppLayout";
import {
  BrowserPoolDashboard,
} from "@/components/automation/BrowserPoolDashboard";

export default function BrowserPoolPage() {
  return (
    <AppLayout>
      <BrowserPoolDashboard />
    </AppLayout>
  );
}
