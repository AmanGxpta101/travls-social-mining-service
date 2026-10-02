import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Matches, MaxLength } from "class-validator";

export class InvalidateShareDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  by!: string;
}

export class DeductPointsDto {
  /** Optional: the post this deduction is about. */
  @IsOptional()
  @IsString()
  shareId?: string;

  /** How many points to take away (positive). */
  @IsInt()
  @IsPositive()
  points!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  by!: string;
}

export class BlockTaskDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  by!: string;
}

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string;

  @IsString()
  @MaxLength(200)
  description!: string;

  @IsString()
  @IsNotEmpty()
  template!: string;

  // Multipart forms (a challenge with an image) send every field as text.
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  points!: number;

  @IsString()
  @IsNotEmpty()
  by!: string;

  /** YYYY-MM-DD, end of that day IST. Omitted or empty: no deadline. */
  @IsOptional()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/)
  deadline?: string;
}

export class SetTaskDeadlineDto {
  /** YYYY-MM-DD, or null to remove the deadline. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deadline!: string | null;
}

export class SetTaskActiveDto {
  @IsBoolean()
  active!: boolean;
}
