import { IsString } from "class-validator";

export class CreateShareDto {
  /** Which task from the catalog (GET /v1/tasks) this share is for. */
  @IsString()
  taskId!: string;
}
