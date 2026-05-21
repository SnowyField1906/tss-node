import { ConfigService } from '@nestjs/config'
import { of } from 'rxjs'

import { BN, C, SMT } from '@common'
import { DkgService } from '@services/dkg.service'
import { TssService } from '@services/tss.service'

const mockData = {
    1: C.generateKeyPair(),
    2: C.generateKeyPair(),
    3: C.generateKeyPair(),
}
class MockModel {
    private data: any[] = []
    async deleteMany(query: any = {}) {
        this.data = []
        return { acknowledged: true, deletedCount: this.data.length }
    }
    async deleteOne(query: any = {}) {
        const index = this.data.findIndex((item) => Object.keys(query).every((k) => item[k] === query[k]))
        if (index > -1) this.data.splice(index, 1)
    }
    async findOne(query: any = {}) {
        return this.data.find((item) => Object.keys(query).every((k) => item[k] === query[k])) || null
    }
    async find(query: any = {}) {
        return this.data.filter((item) => Object.keys(query).every((k) => item[k] === query[k]))
    }
    async updateOne(query: any = {}, updateData: any = {}, options: any = {}) {
        const update = updateData.$set || updateData
        const index = this.data.findIndex((item) => Object.keys(query).every((k) => item[k] === query[k]))
        if (index > -1) this.data[index] = { ...this.data[index], ...update }
        else if (options.upsert) this.data.push({ ...query, ...update })
    }
    async findOneAndUpdate(query: any = {}, updateData: any = {}, options: any = {}) {
        const update = updateData.$set || updateData
        const index = this.data.findIndex((item) => Object.keys(query).every((k) => item[k] === query[k]))
        if (index > -1) {
            this.data[index] = { ...this.data[index], ...update }
            return this.data[index]
        } else if (options.upsert) {
            const newItem = { ...query, ...update }
            this.data.push(newItem)
            return newItem
        }
        return null
    }
}
const mockHttpService = {
    get: jest.fn().mockImplementation((url: string, config: any) => {
        if (url.includes('latest-state')) {
            const uidHex = config.params.userId.replace('0x', '').padStart(40, '0')
            const smt = new SMT()
            return of({
                data: {
                    nonce: 0,
                    root: smt.getRoot(),
                    signature: null,
                    oldBalance: '0',
                    merkleProof: smt.prove(uidHex),
                },
            })
        }
    }),
    post: jest.fn().mockImplementation(() => {
        return of({ data: { success: true } })
    }),
} as any
const createMock = (id: number) => {
    const privateKey = mockData[id].getPrivate('hex')
    const config = {
        get: (key: string) => {
            if (key === 'id') return id
            if (key === 'privateKey') return privateKey
            if (key === 'orchestratorUrl') return `http://localhost:3000`
            if (key === 'networkPublicKeys')
                return Object.fromEntries(Object.entries(mockData).map(([k, v]) => [k, v.getPublic('hex')]))
            return null
        },
    } as ConfigService
    const keyModel = new MockModel() as any
    const shareModel = new MockModel() as any
    const tssStateModel = new MockModel() as any
    const pendingTransactionModel = new MockModel() as any
    const dkgService = new DkgService(keyModel, shareModel, config)
    const tssService = new TssService(
        keyModel,
        shareModel,
        tssStateModel,
        pendingTransactionModel,
        config,
        mockHttpService
    )
    return { id, dkgService, tssService, keyModel, tssStateModel, pendingTransactionModel }
}

describe('Threshold Signature Scheme (n=3, t=2)', () => {
    const n = 3,
        t = 2
    const subsetIds = [1, 2]

    const chainId = '1'
    const userId = '1234567890123456789012345678901234567890'
    const amount = '100'

    let nodes: ReturnType<typeof createMock>[] = []
    let Y_Public: string
    let sharedMessageHash: string

    const startDataAll: any[] = []
    const mtaDataAll: any[] = []
    const deltaDataAll: any[] = []

    beforeAll(async () => {
        nodes = [createMock(1), createMock(2), createMock(3)]

        const bData = []
        for (const node of nodes) bData.push({ id: node.id, ...(await node.dkgService.broadcastDkgShares(t, n)) })
        const fcAll = []
        for (const receiver of nodes) {
            const batchedShares: any[] = []
            for (const sender of bData) {
                const share = sender.data.find((x: any) => x.j === receiver.id)
                batchedShares.push({
                    i: sender.id,
                    encryptedPayload: share.encryptedPayload,
                    commitments: sender.commitments,
                })
            }
            fcAll.push((await receiver.dkgService.receiveDkgShares(batchedShares)).feldmanCommitments)
        }
        for (const node of nodes) {
            await node.dkgService.computePublicKey(fcAll)
        }
        const keyDoc = await nodes[0].keyModel.findOne({})
        Y_Public = keyDoc.Y
    })

    it('Phase 0: Nodes propose transaction and generate messageHash', async () => {
        const hashes: string[] = []

        for (const id of subsetIds) {
            const node = nodes[id - 1]
            const res = await node.tssService.proposeTransaction(chainId, userId, amount)
            hashes.push(res.messageHash)

            const pending = await node.pendingTransactionModel.findOne({ chainId })
            expect(pending).toBeDefined()
            expect(pending.messageHash).toBe(res.messageHash)
        }

        expect(hashes[0]).toEqual(hashes[1])

        sharedMessageHash = hashes[0]
    })

    it('Phase 1: Start (k_i, w_i, Paillier encryption)', async () => {
        for (const id of subsetIds) {
            const node = nodes[id - 1]

            const res = await node.tssService.tssStart(sharedMessageHash, subsetIds)
            startDataAll.push(res)

            expect(res.E_k).toBeDefined()
            expect(res.E_x).toBeDefined()
            expect(res.Gamma).toBeDefined()
        }
    })

    it('Phase 2: MtA round 1 & 2', async () => {
        for (const id of subsetIds) {
            const node = nodes[id - 1]

            const others = startDataAll.filter((d) => d.i !== node.id).map((d) => ({ j: d.i, E_k: d.E_k, E_x: d.E_x }))

            const res = await node.tssService.tssMta(sharedMessageHash, others)
            mtaDataAll.push(res)
        }
        expect(mtaDataAll.length).toBe(t)
    })

    it('Phase 3: Delta + Sigma', async () => {
        for (const id of subsetIds) {
            const node = nodes[id - 1]

            const alphasForMe = mtaDataAll
                .filter((d) => d.i !== node.id)
                .map((d) => {
                    const a = d.alphas.find((x: any) => x.j === node.id)
                    return { j: d.i, alpha: a.alpha }
                })
            const nusForMe = mtaDataAll
                .filter((d) => d.i !== node.id)
                .map((d) => {
                    const a = d.nus.find((x: any) => x.j === node.id)
                    return { j: d.i, nu: a.nu }
                })

            const res = await node.tssService.tssDelta(sharedMessageHash, alphasForMe, nusForMe)
            deltaDataAll.push(res)
        }
    })

    it('Phase 4: Distributed ECDSA signature and state commit', async () => {
        let delta = BN.ZERO
        for (const d of deltaDataAll) delta = delta.add(BN.from(d.delta_i, 16)).umod(C.ORDER)
        const delta_inv = delta.invm(C.ORDER)

        let GammaSum: any = null
        for (const d of startDataAll) {
            const Gamma_i = C.secp256k1.curve.decodePoint(d.Gamma, 'hex')
            GammaSum = GammaSum ? GammaSum.add(Gamma_i) : Gamma_i
        }
        const R = GammaSum.mul(delta_inv)
        const r = R.getX().umod(C.ORDER).toString(16)

        let s = BN.ZERO
        for (const id of subsetIds) {
            const node = nodes[id - 1]

            const res = await node.tssService.tssSign(sharedMessageHash, r)
            s = s.add(BN.from(res.s_i, 16)).umod(C.ORDER)
        }

        const halfOrder = C.ORDER.shrn(1)
        if (s.cmp(halfOrder) > 0) s = C.ORDER.sub(s)

        const key = C.secp256k1.keyFromPublic(Y_Public, 'hex')
        const isValid = key.verify(sharedMessageHash, { r, s: s.toString(16) })
        expect(isValid).toBe(true)

        for (const id of subsetIds) {
            const node = nodes[id - 1]
            const dbKey = await node.keyModel.findOne({})

            expect(dbKey.chains[chainId].nonce).toBe(1)
            expect(dbKey.chains[chainId].root).toBeDefined()

            const pendingTx = await node.pendingTransactionModel.findOne({ messageHash: sharedMessageHash })
            expect(pendingTx).toBeNull()

            const tssState = await node.tssStateModel.findOne({ messageHash: sharedMessageHash })
            expect(tssState).toBeNull()
        }
    })
})
