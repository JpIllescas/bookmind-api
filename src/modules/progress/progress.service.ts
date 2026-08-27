import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../documents/entities/document.entity';
import { UpdateProgressDto } from './dto/update-progress.dto';

@Injectable()
export class ProgressService {
  constructor(@InjectRepository(Document) private readonly documents: Repository<Document>) {}
  async resumen(userId: string) {
    const documents = await this.documents.find({ where: { userId }, order: { updatedAt: 'DESC' } });
    const total = documents.length;
    return { documents: documents.map((d) => ({ id: d.id, title: d.title, progress: d.progress, pages: d.pages, processingStatus: d.processingStatus })), total, completed: documents.filter((d) => d.progress >= 100).length, average: total ? Math.round(documents.reduce((sum, d) => sum + d.progress, 0) / total) : 0 };
  }
  async actualizar(userId: string, id: string, dto: UpdateProgressDto) {
    const doc = await this.documents.findOneBy({ id, userId });
    if (!doc) throw new NotFoundException('No se encontró el documento.');
    doc.progress = dto.progress;
    return this.documents.save(doc);
  }
}
