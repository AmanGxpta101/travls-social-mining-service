import { IsIn } from "class-validator";

export class ConnectInitDto {
  @IsIn(["web", "mobile"])
  platform!: "web" | "mobile";
}
