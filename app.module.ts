import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'

import configuration from '@config'
import { DkgController, PingController, TssController } from '@controllers'
import {
    Key,
    KeySchema,
    PendingTransaction,
    PendingTransactionSchema,
    Share,
    ShareSchema,
    TssState,
    TssStateSchema,
} from '@schemas'
import { DkgService, PingService, TssService } from '@services'

@Module({
    imports: [
        HttpModule,
        ConfigModule.forRoot({
            load: [configuration as any],
        }),
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => {
                return {
                    uri: configService.get<string>('mongoUri'),
                }
            },
            inject: [ConfigService],
        }),
        MongooseModule.forFeature([
            { name: Key.name, schema: KeySchema },
            { name: Share.name, schema: ShareSchema },
            { name: TssState.name, schema: TssStateSchema },
            { name: PendingTransaction.name, schema: PendingTransactionSchema },
        ]),
        ConfigModule,
    ],
    controllers: [DkgController, PingController, TssController],
    providers: [DkgService, PingService, TssService],
})
export class AppModule {}
