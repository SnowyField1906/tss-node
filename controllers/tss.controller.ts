import { Body, Controller, Post } from '@nestjs/common'

import {
    TssDeltaRequest,
    TssDeltaResponse,
    TssMtaRequest,
    TssMtaResponse,
    TssProposeRequest,
    TssProposeResponse,
    TssSignRequest,
    TssSignResponse,
    TssStartRequest,
    TssStartResponse,
} from '@dtos'
import { TssService } from '@services'

@Controller('tss')
export class TssController {
    constructor(private readonly tssService: TssService) {}

    @Post('propose')
    async tssPropose(@Body() data: TssProposeRequest): Promise<TssProposeResponse> {
        return await this.tssService.proposeTransaction(data.chainId, data.userId, data.amount)
    }

    @Post('start')
    async tssStart(@Body() data: TssStartRequest): Promise<TssStartResponse> {
        return await this.tssService.tssStart(data.messageHash, data.subsetIds)
    }

    @Post('mta')
    async tssMta(@Body() data: TssMtaRequest): Promise<TssMtaResponse> {
        return await this.tssService.tssMta(data.messageHash, data.others)
    }

    @Post('delta')
    async tssDelta(@Body() data: TssDeltaRequest): Promise<TssDeltaResponse> {
        return await this.tssService.tssDelta(data.messageHash, data.alphas, data.nus)
    }

    @Post('sign')
    async tssSign(@Body() data: TssSignRequest): Promise<TssSignResponse> {
        return await this.tssService.tssSign(data.messageHash, data.r)
    }
}
