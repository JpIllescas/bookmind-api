import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateStudyPlanDto } from './dto/create-study-plan.dto';
import { GenerateStudyPlanDto } from './dto/generate-study-plan.dto';
import { StudyService } from './study.service';

@Controller('study-plans') @UseGuards(JwtAuthGuard)
export class StudyController {
  constructor(private readonly study: StudyService) {}
  @Get() listar(@CurrentUser() u: AuthUser) { return this.study.listar(u.id); }
  @Post() crear(@CurrentUser() u: AuthUser, @Body() dto: CreateStudyPlanDto) { return this.study.crear(u.id, dto); }
  @Post('generate') generar(@CurrentUser() u: AuthUser, @Body() dto: GenerateStudyPlanDto) { return this.study.generar(u.id, dto.documentId); }
  @Patch(':id/tasks/:taskIndex') completar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('taskIndex', ParseIntPipe) taskIndex: number) { return this.study.completar(u.id, id, taskIndex); }
}
