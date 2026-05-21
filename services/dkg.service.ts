import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'

import { BN, C, E, P } from '@common'
import { BroadcastDkgResponse, ReceiveDkgDataRequest } from '@dtos'
import { PVSS } from '@libs/pvss'
import { Key, KeyDocument, Share, ShareDocument } from '@schemas'

@Injectable()
export class DkgService {
    private nodeId: number
    private secret: string
    private publicKeys: { [j: number]: string }

    private pvss: PVSS

    constructor(
        @InjectModel(Key.name) private keyModel: Model<KeyDocument>,
        @InjectModel(Share.name) private shareModel: Model<ShareDocument>,
        private readonly configService: ConfigService
    ) {
        this.nodeId = this.configService.get<number>('id')
        this.secret = this.configService.get<string>('privateKey')
        this.publicKeys = {}
        const networkPublicKeys = this.configService.get<Record<number, string>>('networkPublicKeys')
        for (const [j, Y_j] of Object.entries(networkPublicKeys)) {
            this.publicKeys[Number(j)] = Y_j
        }

        this.pvss = new PVSS()
    }

    async broadcastDkgShares(t: number, n: number): Promise<BroadcastDkgResponse> {
        await this.keyModel.deleteMany({})
        await this.shareModel.deleteMany({})

        const paillier = await P.generateKeyPair(1024)

        const f_poly = this.pvss.generatePolynomial(BN.from(this.secret), t - 1)
        const noise = BN.from(C.generatePrivateKey())
        const g_poly = this.pvss.generatePolynomial(noise, t - 1)

        const commitments = this.pvss.generatePedersenCommitments(f_poly, g_poly)

        const data: BroadcastDkgResponse['data'] = []
        for (let j = 1; j <= n; j++) {
            const s = this.pvss.evaluatePolynomial(f_poly, BN.from(j))
            const t = this.pvss.evaluatePolynomial(g_poly, BN.from(j))

            const payload = { s: s.toString(16), t: t.toString(16), ...paillier.publicKey }
            const payloadHex = Buffer.from(JSON.stringify(payload)).toString('hex')
            const encryptedPayload = await E.encrypt(this.publicKeys[j], payloadHex)
            data.push({ j, encryptedPayload })
        }

        await this.keyModel.updateOne(
            {},
            { paillier, f_poly: f_poly.map((p) => p.toString(16)), chains: {} },
            { upsert: true }
        )

        return { commitments, data }
    }

    async receiveDkgShares(shares: ReceiveDkgDataRequest['shares']) {
        if (!shares || shares.length === 0) {
            throw new BadRequestException('No shares received in the batch')
        }

        let x_i = BN.ZERO
        for (const share of shares) {
            const decryptedHex = await E.decrypt(this.secret, share.encryptedPayload)
            const parsed = JSON.parse(Buffer.from(decryptedHex, 'hex').toString('utf8'))

            const isValid = this.pvss.verifyShare(
                BN.from(this.nodeId),
                BN.from(parsed.s),
                BN.from(parsed.t),
                share.commitments
            )

            if (!isValid) {
                throw new BadRequestException(`Invalid PVSS share from node ${share.i}`)
            }

            const paillierPublicKey = { n: parsed.n, g: parsed.g }
            await this.shareModel.updateOne(
                { i: share.i },
                { s_ij: parsed.s, t_ij: parsed.t, paillierPublicKey },
                { upsert: true }
            )

            x_i = x_i.add(BN.from(parsed.s)).umod(C.ORDER)
        }

        const keyDoc = await this.keyModel.findOne({})
        if (!keyDoc || !keyDoc.f_poly) {
            throw new BadRequestException('Key document or f_poly not found')
        }

        await this.keyModel.updateOne({}, { x_i: x_i.toString(16) })

        const f_poly = keyDoc.f_poly.map((p) => BN.from(p))
        const feldmanCommitments = this.pvss.generateFeldmanCommitments(f_poly)

        return { feldmanCommitments }
    }

    async computePublicKey(feldmanCommitments: string[][]) {
        const keyDoc = await this.keyModel.findOne({})
        if (!keyDoc || !keyDoc.x_i) {
            throw new BadRequestException('Local key share x_i not found')
        }

        const x_i = BN.from(keyDoc.x_i)
        const isMasterShareValid = this.pvss.verifyMasterShare(BN.from(this.nodeId), x_i, feldmanCommitments)
        if (!isMasterShareValid) {
            throw new BadRequestException('Master share verification failed. DKG aborted.')
        }

        // Y = Sum(A_{j,0})
        let Y_point: any = null
        for (const commitments of feldmanCommitments) {
            const A_j0 = C.secp256k1.curve.decodePoint(commitments[0], 'hex')
            Y_point = Y_point ? Y_point.add(A_j0) : A_j0
        }
        const Y = Y_point.encode('hex', false)
        await this.keyModel.updateOne({}, { Y })

        return { success: true }
    }
}
