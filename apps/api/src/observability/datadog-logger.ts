import { ConsoleLogger } from '@nestjs/common';
import { sendDatadogLog, type DatadogLogLevel } from './datadog-log';

export class DatadogLogger extends ConsoleLogger {
  private forward(level: DatadogLogLevel, message: unknown, context?: string) {
    sendDatadogLog(level, [context, message].filter(Boolean).join(' '));
  }

  override log(message: any, context?: string) { super.log(message, context); this.forward('info', message, context); }
  override error(message: any, stack?: string, context?: string) { super.error(message, stack, context); this.forward('error', [message, stack].filter(Boolean).join('\n'), context); }
  override warn(message: any, context?: string) { super.warn(message, context); this.forward('warn', message, context); }
  override debug(message: any, context?: string) { super.debug(message, context); this.forward('debug', message, context); }
  override verbose(message: any, context?: string) { super.verbose(message, context); this.forward('debug', message, context); }
}
