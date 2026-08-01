import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ConstructorParseTest {
    constructor(
        private readonly config: ConfigService,
    ) {}
}
