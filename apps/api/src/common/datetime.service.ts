import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class DateTimeService {
  toUtc(
    localDate: string,
    localTime: string,
    timezone: string,
  ): Date {
    this.validateDate(localDate);
    this.validateTime(localTime);

    const [year, month, day] = localDate
      .split('-')
      .map(Number);

    const [hour, minute] = localTime
      .split(':')
      .map(Number);

    const utcGuess = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        0,
        0,
      ),
    );

    const formatter = new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      },
    );

    const offset =
      this.getTimezoneOffsetMilliseconds(
        utcGuess,
        formatter,
      );

    const result = new Date(
      utcGuess.getTime() - offset,
    );

    const verification =
      this.formatLocalParts(
        result,
        formatter,
      );

    if (
      verification.date !== localDate ||
      verification.time !== localTime
    ) {
      throw new BadRequestException(
        [
          'Invalid or unsupported local date/time.',
          `${localDate} ${localTime}`,
          timezone,
        ].join(' '),
      );
    }

    return result;
  }

  toLocal(
    value: Date | string,
    timezone: string,
  ) {
    const date =
      value instanceof Date
        ? value
        : new Date(value);

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      throw new BadRequestException(
        'Invalid date value.',
      );
    }

    const formatter =
      new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        },
      );

    return this.formatLocalParts(
      date,
      formatter,
    );
  }

  private getTimezoneOffsetMilliseconds(
    date: Date,
    formatter: Intl.DateTimeFormat,
  ) {
    const parts =
      this.getParts(
        date,
        formatter,
      );

    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );

    return asUtc - date.getTime();
  }

  private formatLocalParts(
    date: Date,
    formatter: Intl.DateTimeFormat,
  ) {
    const parts =
      this.getParts(
        date,
        formatter,
      );

    return {
      date: [
        parts.year,
        String(parts.month).padStart(
          2,
          '0',
        ),
        String(parts.day).padStart(
          2,
          '0',
        ),
      ].join('-'),
      time: [
        String(parts.hour).padStart(
          2,
          '0',
        ),
        String(parts.minute).padStart(
          2,
          '0',
        ),
      ].join(':'),
      second: parts.second,
      timezone:
        formatter.resolvedOptions()
          .timeZone,
      iso: date.toISOString(),
    };
  }

  private getParts(
    date: Date,
    formatter: Intl.DateTimeFormat,
  ) {
    const values =
      Object.fromEntries(
        formatter
          .formatToParts(date)
          .filter(
            (part) =>
              part.type !== 'literal',
          )
          .map(
            (part) => [
              part.type,
              Number(part.value),
            ],
          ),
      );

    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      second: values.second,
    };
  }

  private validateDate(
    value: string,
  ) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        value,
      )
    ) {
      throw new BadRequestException(
        'Date must use YYYY-MM-DD format.',
      );
    }

    const date = new Date(
      `${value}T00:00:00Z`,
    );

    if (
      Number.isNaN(
        date.getTime(),
      ) ||
      date
        .toISOString()
        .slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        'Invalid calendar date.',
      );
    }
  }

  private validateTime(
    value: string,
  ) {
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(
        value,
      )
    ) {
      throw new BadRequestException(
        'Time must use HH:mm format.',
      );
    }
  }
}
