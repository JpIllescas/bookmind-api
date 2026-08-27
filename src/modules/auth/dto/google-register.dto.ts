import { IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleRegisterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  idToken: string;
}
