import { IsString } from "class-validator";

export class ConfirmShareDto {
  /** The post URL (x.com/twitter.com .../status/<id>) or the bare post id. */
  @IsString()
  post!: string;
}
