import { Body, Controller, Post } from '@nestjs/common'

import {
    BroadcastDkgRequest,
    BroadcastDkgResponse,
    ComputePublicKeyRequest,
    ComputePublicKeyResponse,
    ReceiveDkgDataRequest,
    ReceiveDkgDataResponse,
} from '@dtos'
import { DkgService } from '@services'

@Controller('dkg')
export class DkgController {
    constructor(private readonly dkgService: DkgService) {}

    @Post('broadcast')
    async broadcastDkgShares(@Body() data: BroadcastDkgRequest): Promise<BroadcastDkgResponse> {
        const result = await this.dkgService.broadcastDkgShares(data.t, data.n)
        return result
    }

    @Post('receive')
    async receiveDkgShares(@Body() data: ReceiveDkgDataRequest): Promise<ReceiveDkgDataResponse> {
        return await this.dkgService.receiveDkgShares(data.shares)
    }

    @Post('compute-public-key')
    async computePublicKey(@Body() data: ComputePublicKeyRequest): Promise<ComputePublicKeyResponse> {
        return await this.dkgService.computePublicKey(data.feldmanCommitments)
    }
}
