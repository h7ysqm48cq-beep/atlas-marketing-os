import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { DateTimeService } from '../common/datetime.service';

export type PostingDay =
  | 'SUN'
  | 'MON'
  | 'TUE'
  | 'WED'
  | 'THU'
  | 'FRI'
  | 'SAT';

export type QueuePlannerInput = {
  startDate: string;
  postingDays: PostingDay[];
  postingTime: string;
  numberOfPosts: number;
  timezone?: string;
};

export type PlannedSchedule = {
  localDate: string;
  localTime: string;
  timezone: string;
  scheduledAtUtc: Date;
};

@Injectable()
export class QueuePlannerService {
  private readonly weekdayMap: Record<
    PostingDay,
    number
  > = {
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
  };

  constructor(
    private readonly dateTimeService:
      DateTimeService,
  ) {}

  planQueue(
    input: QueuePlannerInput,
  ): PlannedSchedule[] {
    this.validateInput(input);

    const timezone =
      input.timezone ||
      'Asia/Kuala_Lumpur';

    const allowedDays: number[] =
      input.postingDays.map(
        (day) => this.weekdayMap[day],
      );

    const schedules: PlannedSchedule[] = [];

    const [year, month, day] =
      input.startDate
        .split('-')
        .map(Number);

    // Use UTC calendar arithmetic only to move
    // between calendar dates without depending on
    // the server's local timezone.
    const currentDate = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        0,
        0,
        0,
        0,
      ),
    );

    let safetyCounter = 0;

    while (
      schedules.length <
      input.numberOfPosts
    ) {
      safetyCounter += 1;

      if (safetyCounter > 3660) {
        throw new BadRequestException(
          'Unable to generate queue dates.',
        );
      }

      if (
        allowedDays.includes(
          currentDate.getUTCDay(),
        )
      ) {
        const localDate =
          currentDate
            .toISOString()
            .slice(0, 10);

        const scheduledAtUtc =
          this.dateTimeService.toUtc(
            localDate,
            input.postingTime,
            timezone,
          );

        schedules.push({
          localDate,
          localTime:
            input.postingTime,
          timezone,
          scheduledAtUtc,
        });
      }

      currentDate.setUTCDate(
        currentDate.getUTCDate() + 1,
      );
    }

    return schedules;
  }

  private validateInput(
    input: QueuePlannerInput,
  ) {
    if (!input.startDate) {
      throw new BadRequestException(
        'startDate is required.',
      );
    }

    if (!input.postingDays?.length) {
      throw new BadRequestException(
        'At least one posting day is required.',
      );
    }

    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(
        input.postingTime,
      )
    ) {
      throw new BadRequestException(
        'postingTime must use HH:mm format.',
      );
    }

    if (
      !Number.isInteger(
        input.numberOfPosts,
      ) ||
      input.numberOfPosts < 1 ||
      input.numberOfPosts > 500
    ) {
      throw new BadRequestException(
        'numberOfPosts must be between 1 and 500.',
      );
    }

    const invalidDay =
      input.postingDays.find(
        (day) =>
          this.weekdayMap[day] ===
          undefined,
      );

    if (invalidDay) {
      throw new BadRequestException(
        `Invalid posting day: ${invalidDay}.`,
      );
    }
  }
}
