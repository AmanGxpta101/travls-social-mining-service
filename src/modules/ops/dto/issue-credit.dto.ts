import { IsNumber, IsPositive, IsString } from "class-validator";

export class IssueCreditDto {
  @IsString()
  shareId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  issuedBy!: string;
}
