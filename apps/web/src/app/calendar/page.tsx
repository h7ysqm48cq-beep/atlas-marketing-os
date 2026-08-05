import { AppLayout } from "@/components/AppLayout";
import { CalendarImageLightbox } from "@/components/calendar/CalendarImageLightbox";
import { ContentCalendar } from "@/components/calendar/ContentCalendar";

export default function CalendarPage() {
  return (
    <AppLayout>
      <CalendarImageLightbox>
        <ContentCalendar />
      </CalendarImageLightbox>
    </AppLayout>
  );
}
