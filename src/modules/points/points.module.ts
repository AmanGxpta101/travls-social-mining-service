import { Global, Module } from "@nestjs/common";
import { PointsService, TRAVLS_POINTS_CLIENT } from "./points.service";
import { createTravlsPointsClient } from "./travls-points.client";
import { TravlsApiLog } from "./travls-api-log";
import { TravlsSyncSwitch } from "./travls-sync-switch";

// Global: points are recorded from share, ops and connect alike.
@Global()
@Module({
  providers: [
    PointsService,
    TravlsApiLog,
    TravlsSyncSwitch,
    {
      provide: TRAVLS_POINTS_CLIENT,
      useFactory: (log: TravlsApiLog) => createTravlsPointsClient((call) => log.record(call)),
      inject: [TravlsApiLog],
    },
  ],
  exports: [PointsService, TravlsApiLog, TravlsSyncSwitch],
})
export class PointsModule {}
