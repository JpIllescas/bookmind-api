import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module';
import { MlModule } from '../ml/ml.module';
import { HealthController } from './health.controller';

@Module({
  imports: [MlModule, DocumentsModule],
  controllers: [HealthController],
})
export class HealthModule {}
