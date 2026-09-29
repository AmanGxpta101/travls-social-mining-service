import { IsOptional, IsString } from "class-validator";

export class AddKolDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  handle?: string;

  @IsString()
  addedBy!: string;
}
