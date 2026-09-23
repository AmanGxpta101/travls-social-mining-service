import { IsString } from "class-validator";

export class ConnectCallbackDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;
}
