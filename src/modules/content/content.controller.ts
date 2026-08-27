import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { GenerateContentDto } from './dto/generate-content.dto';
import { ContentService } from './content.service';
@Controller('documents/:documentId/content') @UseGuards(JwtAuthGuard)
export class ContentController {
  constructor(private readonly content: ContentService) {}
  @Get() listar(@CurrentUser() u: AuthUser, @Param('documentId', ParseUUIDPipe) id: string) { return this.content.listar(u.id, id); }
  @Post() generar(@CurrentUser() u: AuthUser, @Param('documentId', ParseUUIDPipe) id: string, @Body() dto: GenerateContentDto) { return this.content.generar(u.id, id, dto.type); }
}
