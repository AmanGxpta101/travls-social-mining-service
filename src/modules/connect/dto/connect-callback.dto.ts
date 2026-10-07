import { IsOptional, IsString } from "class-validator";

export class ConnectCallbackDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;

  /** The user's Travls access token, when they came in from the cards dashboard. */
  @IsOptional()
  @IsString()
  travlsToken?: string;
}

export class LinkTravlsDto {
  /** The user's Travls access token (the cards dashboard's JWT). */
  @IsString()
  token!: string;
}
