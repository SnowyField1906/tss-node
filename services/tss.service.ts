import { HttpService } from '@nestjs/axios'
import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { firstValueFrom } from 'rxjs'

import { BN, C, H, P, SMT } from '@common'
import { TssDeltaRequest, TssMtaRequest, TssStartResponse } from '@dtos'
import {
    Key,
    KeyDocument,
    PendingTransaction,
    PendingTransactionDocument,
    Share,
    ShareDocument,
    TssState,
    TssStateDocument,
} from '@schemas'

@Injectable()
export class TssService {
    private nodeId: number
    private orchestratorUrl: string

    constructor(
        @InjectModel(Key.name) private keyModel: Model<KeyDocument>,
        @InjectModel(Share.name) private shareModel: Model<ShareDocument>,
        @InjectModel(TssState.name) private tssStateModel: Model<TssStateDocument>,
        @InjectModel(PendingTransaction.name) private pendingTransactionModel: Model<PendingTransactionDocument>,
        private readonly configService: ConfigService,
        private readonly httpService: HttpService
    ) {
        this.nodeId = this.configService.get<number>('id')
        this.orchestratorUrl = this.configService.get<string>('orchestratorUrl')
    }

    async proposeTransaction(chainId: string, userId: string, amountHex: string) {
        const key = await this.keyModel.findOne({})
        let isNewChain = false

        if (!key.chains) {
            key.chains = {}
            isNewChain = true
        }
        if (!key.chains[chainId]) {
            key.chains[chainId] = { nonce: 0, root: new SMT().getRoot() }
            isNewChain = true
        }
        if (isNewChain) {
            await this.keyModel.updateOne({}, { $set: { [`chains.${chainId}`]: key.chains[chainId] } })
        }

        const localState = key.chains[chainId]

        // Step 1: Ask for data and proof from Orchestrator
        const latestState: LatestState = await firstValueFrom(
            this.httpService.get(`${this.orchestratorUrl}/fund/latest-state`, { params: { chainId, userId } })
        ).then((res) => res.data)

        // Step 2: Catch-up if node is outdated
        if (latestState.nonce > localState.nonce) {
            if (!latestState.signature) {
                throw new BadRequestException('Root mismatch but no catchup signature provided by Orchestrator')
            }

            const syncMessage = H.sha256(
                Buffer.concat([
                    Buffer.from(chainId),
                    Buffer.from(latestState.nonce.toString()),
                    Buffer.from(latestState.root, 'hex'),
                ] as any)
            )
            const verifierKey = C.secp256k1.keyFromPublic(key.Y, 'hex')
            const isValidCatchup = verifierKey.verify(syncMessage, latestState.signature)

            if (!isValidCatchup) {
                throw new BadRequestException('Failed to verify target root signature. Orchestrator might be malicious')
            }

            localState.nonce = latestState.nonce
            localState.root = latestState.root

            await this.keyModel.updateOne({}, { $set: { [`chains.${chainId}`]: localState } })
        } else if (latestState.nonce < localState.nonce) {
            throw new BadRequestException('Orchestrator is outdated relative to local node')
        }

        // Step 3: Verify old state
        const smt = new SMT()
        const userIdHex = userId.padStart(40, '0')
        const oldBalanceHex = latestState.oldBalance.padStart(64, '0')
        const oldLeaf = userIdHex + oldBalanceHex

        let isProofValid = smt.verify(userIdHex, oldLeaf, latestState.merkleProof, localState.root)
        if (!isProofValid && BN.from(latestState.oldBalance).isZero()) {
            isProofValid = smt.verify(userIdHex, '00', latestState.merkleProof, localState.root)
        }
        if (!isProofValid) throw new BadRequestException('Merkle proof provided by Orchestrator is incorrect')

        // Step 4: Compute new root
        const newBalance = BN.from(latestState.oldBalance).add(BN.from(amountHex))
        const newBalanceHex = newBalance.toString(16).padStart(64, '0')
        const newLeaf = userIdHex + newBalanceHex
        const newRoot = smt.computeRootFromProof(userIdHex, newLeaf, latestState.merkleProof)

        // Step 5: Generate message hash and update local state
        const newNonce = localState.nonce + 1
        const messagePayload = Buffer.concat([
            Buffer.from(chainId),
            Buffer.from(newNonce.toString()),
            Buffer.from(newRoot, 'hex'),
        ] as any) as any
        const messageHash = H.sha256(messagePayload)

        await this.pendingTransactionModel.findOneAndUpdate(
            { chainId },
            { newRoot, newNonce, messageHash },
            { upsert: true }
        )

        // Step 6: Propose transaction
        await firstValueFrom(
            this.httpService.post(`${this.orchestratorUrl}/fund/propose`, {
                i: this.nodeId,
                messageHash,
                payload: { chainId, userId, amount: amountHex },
            })
        )

        return { messageHash }
    }

    async tssStart(messageHash: string, subsetIds?: number[]): Promise<TssStartResponse> {
        const key = await this.keyModel.findOne({})
        const k_i = BN.from(C.generatePrivateKey()).umod(C.ORDER)
        const gamma_i = BN.from(C.generatePrivateKey()).umod(C.ORDER)
        const Gamma = C.secp256k1.curve.g.mul(gamma_i)
        const E_k = P.encrypt(key.paillier.publicKey, k_i)

        let lambda_i = BN.ONE
        const ids = subsetIds || [this.nodeId]
        for (const j of ids) {
            if (j === this.nodeId) continue
            const top = BN.from(j).neg().umod(C.ORDER)
            const bottom = BN.from(this.nodeId).sub(BN.from(j)).umod(C.ORDER)
            lambda_i = lambda_i.mul(top.mul(bottom.invm(C.ORDER))).umod(C.ORDER)
        }
        const w_i = BN.from(key.x_i).mul(lambda_i).umod(C.ORDER)
        const E_x = P.encrypt(key.paillier.publicKey, w_i)

        await this.tssStateModel.updateOne(
            { messageHash },
            {
                k_i: k_i.toString(16),
                gamma_i: gamma_i.toString(16),
                w_i: w_i.toString(16),
                betas: {},
                alphas: {},
                mus: {},
                nus: {},
            },
            { upsert: true }
        )

        return {
            i: this.nodeId,
            E_k: E_k.toString(16),
            E_x: E_x.toString(16),
            Gamma: Gamma.encode('hex', false),
        }
    }

    async tssMta(messageHash: string, others: TssMtaRequest['others']) {
        const state = await this.tssStateModel.findOne({ messageHash })
        if (!state) throw new BadRequestException('TSS state not found')

        const alphas: any[] = []
        const nus: any[] = []
        const betasToSave: any = {}
        const musToSave: any = {}

        for (const other of others) {
            if (other.j === this.nodeId) continue

            const share = await this.shareModel.findOne({ i: other.j })
            const otherPublicKey = share.paillierPublicKey
            if (!otherPublicKey) continue

            // MtA round 1 (for delta = k×gamma):
            //   alpha_{ij} = E_j(k_j × gamma_i - beta_{ij})
            // Using Additive Blinding to avoid negative number Wrap-around in Paillier
            const beta_prime = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const beta_ij = C.ORDER.sub(beta_prime).umod(C.ORDER)
            betasToSave[other.j.toString()] = beta_ij.toString(16)

            const term1_k = P.multiply(otherPublicKey, other.E_k, state.gamma_i)
            const alpha_ij = P.add(otherPublicKey, term1_k, P.encrypt(otherPublicKey, beta_prime))

            alphas.push({ j: other.j, alpha: alpha_ij.toString(16) })

            // MtA round 2 (for sigma = k×x):
            //   nu_{ij} = E_j(w_j × k_i - mu_{ij})
            //   NOTE: k_i (NOT gamma_i)
            const mu_prime = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const mu_ij = C.ORDER.sub(mu_prime).umod(C.ORDER)
            musToSave[other.j.toString()] = mu_ij.toString(16)

            const term1_x = P.multiply(otherPublicKey, other.E_x, state.k_i)
            const nu_ij = P.add(otherPublicKey, term1_x, P.encrypt(otherPublicKey, mu_prime))

            nus.push({ j: other.j, nu: nu_ij.toString(16) })
        }

        await this.tssStateModel.updateOne({ messageHash }, { betas: betasToSave, mus: musToSave })

        return { i: this.nodeId, alphas, nus }
    }

    async tssDelta(
        messageHash: string,
        receivedAlphas: TssDeltaRequest['alphas'],
        receivedNus: TssDeltaRequest['nus']
    ) {
        const state = await this.tssStateModel.findOne({ messageHash })
        const key = await this.keyModel.findOne({})
        if (!state || !key) throw new BadRequestException('State or key not found')

        // delta_i = k_i × gamma_i + sum(alpha_ji + beta_ij)
        // sum(delta_i) = k × gamma
        let delta_i = BN.from(state.k_i).mul(BN.from(state.gamma_i)).umod(C.ORDER)

        for (const alphaObj of receivedAlphas) {
            const alpha_ji = P.decrypt(key.paillier, alphaObj.alpha).umod(C.ORDER)
            delta_i = delta_i.add(alpha_ji).umod(C.ORDER)
        }
        for (const beta of Object.values(state.betas)) {
            delta_i = delta_i.add(BN.from(beta)).umod(C.ORDER)
        }

        // sigma_i = k_i × w_i + sum(nu_ji + mu_ij)
        // sum(sigma_i) = k × x
        let sigma_i = BN.from(state.k_i).mul(BN.from(state.w_i)).umod(C.ORDER)

        for (const nuObj of receivedNus || []) {
            const nu_ji = P.decrypt(key.paillier, nuObj.nu).umod(C.ORDER)
            sigma_i = sigma_i.add(nu_ji).umod(C.ORDER)
        }
        for (const mu of Object.values(state.mus || {})) {
            sigma_i = sigma_i.add(BN.from(mu)).umod(C.ORDER)
        }

        // Save sigma_i for the sign phase
        await this.tssStateModel.updateOne({ messageHash }, { sigma_i: sigma_i.toString(16) })

        return { i: this.nodeId, delta_i: delta_i.toString(16) }
    }

    async tssSign(messageHash: string, r_hex: string) {
        const state = await this.tssStateModel.findOne({ messageHash })
        if (!state) throw new BadRequestException('TSS state not found')

        // s_i = H(m) × k_i + r × sigma_i
        const m = BN.from(messageHash).umod(C.ORDER)
        const k_i = BN.from(state.k_i)
        const sigma_i = BN.from(state.sigma_i)
        const r = BN.from(r_hex).umod(C.ORDER)

        const part1 = m.mul(k_i).umod(C.ORDER)
        const part2 = r.mul(sigma_i).umod(C.ORDER)
        const s_i = part1.add(part2).umod(C.ORDER)

        const pendingTx = await this.pendingTransactionModel.findOne({ messageHash })
        if (!pendingTx) throw new BadRequestException('Pending transaction mapping not found')

        const chainId = pendingTx.chainId
        const key = await this.keyModel.findOne({})

        if (!key.chains) key.chains = {}
        if (!key.chains[chainId]) {
            key.chains[chainId] = { nonce: 0, root: new SMT().getRoot() }
        }

        key.chains[chainId].root = pendingTx.newRoot
        key.chains[chainId].nonce = pendingTx.newNonce
        await this.keyModel.updateOne({}, { $set: { [`chains.${chainId}`]: key.chains[chainId] } })

        await this.pendingTransactionModel.deleteOne({ messageHash })
        await this.tssStateModel.deleteOne({ messageHash })

        return { i: this.nodeId, s_i: s_i.toString(16) }
    }
}
