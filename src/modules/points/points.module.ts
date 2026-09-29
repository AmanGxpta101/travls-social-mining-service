import { Module } from "@nestjs/common";
import { PointsService, TRAVLS_POINTS_CLIENT } from "./points.service";
import { createTravlsPointsClient } from "./travls-points.client";

@Module({
  providers: [PointsService, { provide: TRAVLS_POINTS_CLIENT, useFactory: createTravlsPointsClient }],
  exports: [PointsService],
})
export class PointsModule {}
