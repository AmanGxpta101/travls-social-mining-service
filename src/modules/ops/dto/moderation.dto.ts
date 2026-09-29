import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";

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

  @IsInt()
  @IsPositive()
  points!: number;

  @IsString()
  @IsNotEmpty()
  by!: string;
}

export class SetTaskActiveDto {
  @IsBoolean()
  active!: boolean;
}
