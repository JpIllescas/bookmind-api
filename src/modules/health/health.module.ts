import { Module } from '@nestjs/common';

import { MlModule } from '../ml/ml.module';
import { HealthController } from './health.controller';

@Module({
  imports: [MlModule],
  controllers: [HealthController],
})
export class HealthModule {}
