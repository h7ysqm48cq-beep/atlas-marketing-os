import {
  AppLayout,
} from "@/components/AppLayout";

import {
  SupervisorOwnerPanel,
} from "@/components/engineering/SupervisorOwnerPanel";


export default function EngineeringSupervisorPage() {
  return (
    <AppLayout>
      <SupervisorOwnerPanel />
    </AppLayout>
  );
}
