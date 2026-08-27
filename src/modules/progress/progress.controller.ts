import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { ProgressService } from './progress.service';
@Controller('progress') @UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}
  @Get() resumen(@CurrentUser() u: AuthUser) { return this.progress.resumen(u.id); }
  @Put('documents/:id') actualizar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProgressDto) { return this.progress.actualizar(u.id, id, dto); }
}
